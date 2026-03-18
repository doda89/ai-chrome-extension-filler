const FIELD_SELECTOR = 'input[type="text"], input[type="email"], input[type="tel"], textarea';
const DEFAULT_QUESTION = "Provide a reasonable answer";
const BUTTON_CLASS = "ai-fill-button";

function normalizeText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function getLabelByForAttribute(field) {
  if (!field.id) {
    return "";
  }

  const escapedId = typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(field.id)
    : field.id;
  const label = document.querySelector(`label[for="${escapedId}"]`);

  return normalizeText(label?.textContent);
}

function getWrappedLabelText(field) {
  return normalizeText(field.closest("label")?.textContent);
}

function getNearestParentText(field) {
  let current = field.parentElement;
  let depth = 0;

  while (current && current !== document.body && depth < 4) {
    const clone = current.cloneNode(true);

    clone.querySelectorAll(FIELD_SELECTOR).forEach((element) => {
      element.remove();
    });
    clone.querySelectorAll(`.${BUTTON_CLASS}`).forEach((element) => {
      element.remove();
    });

    const text = normalizeText(clone.textContent);

    if (text) {
      return text;
    }

    current = current.parentElement;
    depth += 1;
  }

  return "";
}

function getFieldQuestion(field) {
  return (
    getLabelByForAttribute(field) ||
    getWrappedLabelText(field) ||
    normalizeText(field.getAttribute("placeholder")) ||
    getNearestParentText(field) ||
    DEFAULT_QUESTION
  );
}

function dispatchFieldEvents(field) {
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function getUserFacingErrorMessage(error) {
  const message = error?.message || "GENERATION_FAILED";

  if (message === "OLLAMA_OFFLINE") {
    return "Ollama is not running";
  }

  if (message.includes("Extension context invalidated")) {
    return "Reload the extension and refresh the page";
  }

  if (message.includes("Could not establish connection")) {
    return "Reload the extension and refresh the page";
  }

  if (message.startsWith("OLLAMA_HTTP_")) {
    return `Ollama error: ${message}`;
  }

  return `Unable to generate an answer: ${message}`;
}

async function fillField(field, button) {
  const originalLabel = button.textContent;
  const question = getFieldQuestion(field);

  button.disabled = true;
  button.textContent = "...";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "AI_FILL_GENERATE",
      question
    });

    if (!response?.ok) {
      throw new Error(response?.error || "GENERATION_FAILED");
    }

    field.value = response.answer;
    dispatchFieldEvents(field);
  } catch (error) {
    console.error("AI Fill error:", error);
    alert(getUserFacingErrorMessage(error));
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

function createButton(field) {
  const button = document.createElement("button");

  button.type = "button";
  button.className = BUTTON_CLASS;
  button.textContent = "AI Fill";
  button.addEventListener("click", () => {
    void fillField(field, button);
  });

  return button;
}

function enhanceField(field) {
  if (!(field instanceof HTMLElement) || field.dataset.aiFillAttached === "true") {
    return;
  }

  field.dataset.aiFillAttached = "true";
  field.insertAdjacentElement("afterend", createButton(field));
}

function enhanceAllFields(root = document) {
  root.querySelectorAll(FIELD_SELECTOR).forEach((field) => {
    enhanceField(field);
  });
}

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    mutation.addedNodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) {
        return;
      }

      if (node.matches?.(FIELD_SELECTOR)) {
        enhanceField(node);
      }

      enhanceAllFields(node);
    });
  }
});

enhanceAllFields();
observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});
