import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  RekognitionClient,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
  CompareFacesCommand,
  DetectFacesCommand,
} from "@aws-sdk/client-rekognition";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export const FACE_CONSENT_VERSION = "attendance-face-v1";
export const FACE_CONSENT_NOTICE =
  "I agree to a live camera check and encrypted reference face storage for attendance identity verification. AWS processes the camera stream. HR reviews enrollment; later checks compare only with my approved face. I can withdraw enrollment and request an audited alternative from HR. No full selfie video is stored by FlurryHR.";
export function faceConfigured() {
  return (
    !!process.env.AWS_FACE_REGION &&
    !!process.env.AWS_FACE_STREAM_ROLE_ARN &&
    /^[a-f0-9]{64}$/i.test(process.env.BIOMETRIC_ENCRYPTION_KEY || "")
  );
}
export function faceThresholds() {
  const liveness = Number(process.env.FACE_LIVENESS_THRESHOLD || 95),
    similarity = Number(process.env.FACE_MATCH_THRESHOLD || 99);
  if (
    !Number.isFinite(liveness) ||
    liveness < 90 ||
    liveness > 100 ||
    !Number.isFinite(similarity) ||
    similarity < 99 ||
    similarity > 100
  )
    throw new ServiceUnavailableException(
      "Biometric thresholds are invalid; contact the platform administrator",
    );
  return { liveness, similarity };
}
export function protectFace(value: string, binding: string) {
  const key = process.env.BIOMETRIC_ENCRYPTION_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key))
    throw new ServiceUnavailableException(
      "Biometric encryption is unavailable",
    );
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  cipher.setAAD(Buffer.from(binding));
  return [
    iv.toString("hex"),
    Buffer.concat([cipher.update(value, "utf8"), cipher.final()]).toString(
      "hex",
    ),
    cipher.getAuthTag().toString("hex"),
  ].join(".");
}
export function revealFace(value: string, binding: string) {
  const [iv, data, tag] = value.split(".");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(process.env.BIOMETRIC_ENCRYPTION_KEY || "", "hex"),
    Buffer.from(iv, "hex"),
  );
  decipher.setAAD(Buffer.from(binding));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
@Injectable()
export class FaceProvider {
  private client() {
    if (!faceConfigured())
      throw new ServiceUnavailableException(
        "AWS face verification has not been configured",
      );
    return new RekognitionClient({
      region: process.env.AWS_FACE_REGION,
      maxAttempts: 2,
    });
  }
  async start(id: string, expiresAt: Date) {
    const client = this.client();
    try {
      const result = await client.send(
        new CreateFaceLivenessSessionCommand({
          ClientRequestToken: id,
          Settings: {
            AuditImagesLimit: 0,
            ChallengePreferences: [{ Type: "FaceMovementAndLightChallenge" }],
          },
        }),
      );
      if (!result.SessionId) throw Error("MISSING_SESSION");
      const sts = new STSClient({
        region: process.env.AWS_FACE_REGION,
        maxAttempts: 2,
      });
      try {
        const token = await sts.send(
          new AssumeRoleCommand({
            RoleArn: process.env.AWS_FACE_STREAM_ROLE_ARN,
            RoleSessionName: `attendance-${id}`,
            DurationSeconds: 900,
            Policy: JSON.stringify({
              Version: "2012-10-17",
              Statement: [
                {
                  Effect: "Allow",
                  Action: "rekognition:StartFaceLivenessSession",
                  Resource: "*",
                  Condition: {
                    StringEquals: {
                      "aws:RequestedRegion": process.env.AWS_FACE_REGION,
                    },
                    DateLessThan: {
                      "aws:CurrentTime": expiresAt.toISOString(),
                    },
                  },
                },
              ],
            }),
          }),
        );
        const c = token.Credentials;
        if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken)
          throw Error("MISSING_CREDENTIALS");
        return {
          sessionId: result.SessionId,
          region: process.env.AWS_FACE_REGION!,
          credentials: {
            accessKeyId: c.AccessKeyId,
            secretAccessKey: c.SecretAccessKey,
            sessionToken: c.SessionToken,
            expiration: expiresAt.toISOString(),
          },
        };
      } finally {
        sts.destroy();
      }
    } catch {
      throw new ServiceUnavailableException(
        "AWS face verification could not start. Retry or contact HR",
      );
    } finally {
      client.destroy();
    }
  }
  async result(sessionId: string) {
    const client = this.client();
    try {
      const result = await client.send(
        new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId }),
      );
      if (
        result.Status !== "SUCCEEDED" ||
        !Number.isFinite(result.Confidence) ||
        !result.ReferenceImage?.Bytes?.length
      )
        return {
          passed: false,
          confidence: result.Confidence ?? 0,
          image: null,
        };
      if (result.ReferenceImage.Bytes.length > 5 * 1024 * 1024)
        throw Error("IMAGE_LIMIT");
      const faces = await client.send(
        new DetectFacesCommand({
          Image: { Bytes: result.ReferenceImage.Bytes },
          Attributes: ["DEFAULT"],
        }),
      );
      if (
        faces.FaceDetails?.length !== 1 ||
        (faces.FaceDetails[0].Confidence ?? 0) < 99
      )
        return { passed: false, confidence: result.Confidence!, image: null };
      return {
        passed: true,
        confidence: result.Confidence!,
        image: Buffer.from(result.ReferenceImage.Bytes),
      };
    } catch {
      throw new ServiceUnavailableException(
        "AWS could not verify this session. Start a new check or contact HR",
      );
    } finally {
      client.destroy();
    }
  }
  async compare(reference: Buffer, current: Buffer) {
    const client = this.client();
    try {
      const result = await client.send(
        new CompareFacesCommand({
          SourceImage: { Bytes: reference },
          TargetImage: { Bytes: current },
          SimilarityThreshold: faceThresholds().similarity,
          QualityFilter: "HIGH",
        }),
      );
      const match = result.FaceMatches;
      return match?.length === 1 && !result.UnmatchedFaces?.length
        ? (match[0].Similarity ?? 0)
        : 0;
    } catch {
      throw new ServiceUnavailableException(
        "AWS face comparison is unavailable. Retry or contact HR",
      );
    } finally {
      client.destroy();
    }
  }
}
