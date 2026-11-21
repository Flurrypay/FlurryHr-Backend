import { test } from "node:test";
import assert from "node:assert/strict";
import { RekognitionClient } from "@aws-sdk/client-rekognition";
import { STSClient } from "@aws-sdk/client-sts";
import { FaceProvider } from "./face-provider";
test("AWS adapter issues only short streaming credentials, retrieves reference bytes and compares without client-provided scores", async () => {
  const old = {
    region: process.env.AWS_FACE_REGION,
    role: process.env.AWS_FACE_STREAM_ROLE_ARN,
    key: process.env.BIOMETRIC_ENCRYPTION_KEY,
  };
  process.env.AWS_FACE_REGION = "us-east-1";
  process.env.AWS_FACE_STREAM_ROLE_ARN =
    "arn:aws:iam::000000000000:role/fixture";
  process.env.BIOMETRIC_ENCRYPTION_KEY = "a".repeat(64);
  const rp = RekognitionClient.prototype as unknown as {
      send: (command: {
        constructor: { name: string };
        input: Record<string, unknown>;
      }) => Promise<unknown>;
    },
    sp = STSClient.prototype as unknown as typeof rp;
  const originalR = rp.send,
    originalS = sp.send;
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  let failure = false;
  rp.send = async (command) => {
    calls.push({ name: command.constructor.name, input: command.input });
    if (failure) throw Error("SENSITIVE_PROVIDER_RESPONSE");
    if (command.constructor.name === "CreateFaceLivenessSessionCommand")
      return { SessionId: "provider-session" };
    if (command.constructor.name === "GetFaceLivenessSessionResultsCommand")
      return {
        Status: "SUCCEEDED",
        Confidence: 98.5,
        ReferenceImage: { Bytes: Buffer.from("fixture-reference") },
      };
    if (command.constructor.name === "DetectFacesCommand")
      return { FaceDetails: [{ Confidence: 99.9 }] };
    return { FaceMatches: [{ Similarity: 99.5 }], UnmatchedFaces: [] };
  };
  sp.send = async (command) => {
    calls.push({ name: command.constructor.name, input: command.input });
    return {
      Credentials: {
        AccessKeyId: "temporary-key",
        SecretAccessKey: "temporary-secret",
        SessionToken: "temporary-session",
      },
    };
  };
  try {
    const provider = new FaceProvider(),
      expires = new Date(Date.now() + 180000);
    const session = await provider.start("fixture-id", expires);
    assert.equal(session.credentials.accessKeyId, "temporary-key");
    assert.equal(session.credentials.expiration, expires.toISOString());
    const create = calls.find(
      (c) => c.name === "CreateFaceLivenessSessionCommand",
    )!;
    assert.deepEqual(create.input.Settings, {
      AuditImagesLimit: 0,
      ChallengePreferences: [{ Type: "FaceMovementAndLightChallenge" }],
    });
    const role = calls.find((c) => c.name === "AssumeRoleCommand")!;
    assert.equal(role.input.DurationSeconds, 900);
    const policy = JSON.parse(role.input.Policy as string);
    assert.equal(
      policy.Statement[0].Action,
      "rekognition:StartFaceLivenessSession",
    );
    assert.equal(
      policy.Statement[0].Condition.DateLessThan["aws:CurrentTime"],
      expires.toISOString(),
    );
    const result = await provider.result("provider-session");
    assert.equal(result.confidence, 98.5);
    assert.equal(result.image?.toString(), "fixture-reference");
    assert.equal(
      await provider.compare(Buffer.from("source"), Buffer.from("target")),
      99.5,
    );
    const comparison = calls.find((c) => c.name === "CompareFacesCommand")!;
    assert.equal(comparison.input.SimilarityThreshold, 99);
    failure = true;
    await assert.rejects(
      provider.result("provider-session"),
      (error) =>
        error instanceof Error &&
        !error.message.includes("SENSITIVE_PROVIDER_RESPONSE") &&
        error.message.includes("AWS"),
    );
  } finally {
    rp.send = originalR;
    sp.send = originalS;
    for (const [key, value] of Object.entries({
      AWS_FACE_REGION: old.region,
      AWS_FACE_STREAM_ROLE_ARN: old.role,
      BIOMETRIC_ENCRYPTION_KEY: old.key,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
