const OLLAMA_ENDPOINT = "http://localhost:11434/api/generate";
const OLLAMA_MODEL = "llama3.1:8b";

function buildPrompt(question) {
  return [
    "You are filling out a form.",
    "Given this field question, generate a realistic but fake answer.",
    "",
    `Question: ${question}`,
    "",
    "Return ONLY the answer text, no explanation."
  ].join("\n");
}

async function generateAnswer(question) {
  let response;

  try {
    response = await fetch(OLLAMA_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: buildPrompt(question),
        stream: false
      })
    });
  } catch (error) {
    const offlineError = new Error("OLLAMA_OFFLINE");
    offlineError.cause = error;
    throw offlineError;
  }

  if (!response.ok) {
    const rawBody = await response.text();
    let details = rawBody;

    try {
      const errorPayload = JSON.parse(rawBody);
      details = typeof errorPayload.error === "string" ? errorPayload.error : rawBody;
    } catch (_error) {
      details = rawBody;
    }

    const suffix = details ? `: ${details.trim()}` : "";
    throw new Error(`OLLAMA_HTTP_${response.status}${suffix}`);
  }

  const payload = await response.json();
  const answer = typeof payload.response === "string" ? payload.response.trim() : "";

  if (!answer) {
    throw new Error("OLLAMA_EMPTY_RESPONSE");
  }

  return answer;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "AI_FILL_GENERATE") {
    return false;
  }

  generateAnswer(message.question)
    .then((answer) => {
      sendResponse({ ok: true, answer });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error.message || "UNKNOWN_ERROR"
      });
    });

  return true;
});
