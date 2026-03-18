const OLLAMA_ENDPOINT = "http://localhost:11434/api/generate";
const OLLAMA_MODEL = "llama3.1:8b";
const PROFILE_DATA_PATH = "profile-data.json";
const MISSING_VALUE_TOKENS = new Set([
  "",
  "n a",
  "na",
  "none",
  "not provided",
  "not available",
  "unknown",
  "null",
  "undefined",
  "tbd"
]);

let profileDataPromise;

function loadProfileData() {
  if (!profileDataPromise) {
    profileDataPromise = fetch(chrome.runtime.getURL(PROFILE_DATA_PATH)).then((response) => {
      if (!response.ok) {
        throw new Error(`PROFILE_DATA_HTTP_${response.status}`);
      }

      return response.json();
    });
  }

  return profileDataPromise;
}

function normalizeText(value) {
  return (value || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 1);
}

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function hasMeaningfulValue(value) {
  if (Array.isArray(value)) {
    return value.some((item) => hasMeaningfulValue(item));
  }

  const normalizedValue = normalizeText(String(value || ""));
  return Boolean(normalizedValue) && !MISSING_VALUE_TOKENS.has(normalizedValue);
}

function getMeaningfulValue(value, formatter = (input) => input) {
  return hasMeaningfulValue(value) ? formatter(value) : "";
}

function resolveKnownField(question, profile) {
  const normalizedQuestion = normalizeText(question);
  const { identity, additional } = profile;

  if (includesAny(normalizedQuestion, ["full name", "your name", "applicant name", "name"])) {
    return getMeaningfulValue(identity.full_name);
  }

  if (includesAny(normalizedQuestion, ["email", "e mail"])) {
    return getMeaningfulValue(identity.email);
  }

  if (includesAny(normalizedQuestion, ["phone", "mobile", "telephone", "cell"])) {
    return getMeaningfulValue(identity.phone);
  }

  if (includesAny(normalizedQuestion, ["location", "city", "state", "where are you based", "address"])) {
    return getMeaningfulValue(identity.location);
  }

  if (includesAny(normalizedQuestion, ["work authorization", "authorized", "eligible to work", "sponsorship", "visa"])) {
    return getMeaningfulValue(additional.work_authorization);
  }

  if (includesAny(normalizedQuestion, ["language", "languages"])) {
    return getMeaningfulValue(additional.languages, (values) => values.join(", "));
  }

  return "";
}

function buildFactEntries(profile) {
  const entries = [];

  if (hasMeaningfulValue(profile.summary)) {
    entries.push({
      category: "summary",
      text: profile.summary
    });
  }

  const identityFacts = [
    hasMeaningfulValue(profile.identity.full_name) ? `Candidate name: ${profile.identity.full_name}.` : "",
    hasMeaningfulValue(profile.identity.email) ? `Email: ${profile.identity.email}.` : "",
    hasMeaningfulValue(profile.identity.phone) ? `Phone: ${profile.identity.phone}.` : "",
    hasMeaningfulValue(profile.identity.location) ? `Location: ${profile.identity.location}.` : ""
  ].filter(Boolean);

  if (identityFacts.length > 0) {
    entries.push({
      category: "identity",
      text: identityFacts.join(" ")
    });
  }

  profile.experience.forEach((role) => {
    entries.push({
      category: "experience",
      text: `${role.title} at ${role.company} (${role.period.start} to ${role.period.end}, ${role.location}). ${role.highlights.join(" ")}`
    });
  });

  profile.education.forEach((education) => {
    entries.push({
      category: "education",
      text: `${education.degree} in ${education.focus} from ${education.institution}.`
    });
  });

  if (hasMeaningfulValue(profile.certifications)) {
    entries.push({
      category: "certifications",
      text: `Certifications: ${profile.certifications.join("; ")}.`
    });
  }

  Object.entries(profile.skills).forEach(([section, values]) => {
    if (!hasMeaningfulValue(values)) {
      return;
    }

    entries.push({
      category: `skills_${section}`,
      text: `${section.replace(/_/g, " ")}: ${values.join(", ")}.`
    });
  });

  const additionalFacts = [
    hasMeaningfulValue(profile.additional.work_authorization)
      ? `Work authorization: ${profile.additional.work_authorization}.`
      : "",
    hasMeaningfulValue(profile.additional.languages)
      ? `Languages: ${profile.additional.languages.join(", ")}.`
      : "",
    hasMeaningfulValue(profile.additional.interests)
      ? `Interests: ${profile.additional.interests.join(", ")}.`
      : ""
  ].filter(Boolean);

  if (additionalFacts.length > 0) {
    entries.push({
      category: "additional",
      text: additionalFacts.join(" ")
    });
  }

  return entries;
}

function getRelevantProfileContext(question, profile) {
  const questionTokens = new Set(tokenize(question));
  const entries = buildFactEntries(profile);

  const rankedEntries = entries
    .map((entry) => {
      const entryTokens = tokenize(entry.text);
      let score = 0;

      for (const token of entryTokens) {
        if (questionTokens.has(token)) {
          score += token.length > 5 ? 3 : 1;
        }
      }

      if (entry.category === "summary") {
        score += 1;
      }

      return {
        ...entry,
        score
      };
    })
    .sort((left, right) => right.score - left.score);

  const topEntries = rankedEntries
    .filter((entry, index) => entry.score > 0 || index < 3)
    .slice(0, 5)
    .map((entry) => `- ${entry.text}`);

  return topEntries.join("\n");
}

function buildPrompt(question, profileContext) {
  return [
    "You are filling out a form for a real candidate profile.",
    "Use the provided profile data whenever it answers the question.",
    "Prefer exact facts from the profile over invented information.",
    "If the profile does not directly answer the question, or a needed value is missing, write a concise made-up answer that is still consistent with the profile.",
    "If the field expects a short value such as name, email, phone, or location, return only that value.",
    "",
    "Relevant profile data:",
    profileContext,
    "",
    `Question: ${question}`,
    "",
    "Return ONLY the answer text, no explanation."
  ].join("\n");
}

async function generateAnswer(question) {
  const profile = await loadProfileData();
  const exactAnswer = resolveKnownField(question, profile);

  if (exactAnswer) {
    return exactAnswer;
  }

  const profileContext = getRelevantProfileContext(question, profile);
  let response;

  try {
    response = await fetch(OLLAMA_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: buildPrompt(question, profileContext),
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
