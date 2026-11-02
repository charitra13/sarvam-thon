import { SarvamAIClient } from "sarvamai";

const apiKey = process.env.SARVAM_API_KEY;
if (!apiKey) {
  console.error("Set SARVAM_API_KEY in .env, then run bun start.");
  process.exit(1);
}

const client = new SarvamAIClient({
  apiSubscriptionKey: apiKey,
  timeoutInSeconds: 30,
  maxRetries: 0,
});

try {
  const response = await client.chat.completions({
    model: "sarvam-105b",
    messages: [{
      role: "user",
      content: process.argv.slice(2).join(" ") ||
        "What is the capital of India? Answer in one sentence.",
    }],
    reasoning_effort: "none",
    max_tokens: 128,
  });

  const reply = response.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    console.error("Sarvam returned an empty reply. Try again.");
    process.exit(1);
  }
  console.log(reply);
} catch (error) {
  const messages = {
    401: "Check the SARVAM_API_KEY in .env and your Sarvam account access.",
    402: "Add credits to your Sarvam account, then try again.",
    403: "Check the SARVAM_API_KEY in .env and your Sarvam account access.",
    429: "Sarvam is rate limiting requests. Wait a moment, then try again.",
  };
  console.error(messages[error?.statusCode] ||
    "Sarvam request failed. Check your connection and account, then retry.");
  process.exitCode = 1;
}
