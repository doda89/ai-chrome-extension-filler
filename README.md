# AI Chrome Extension Filler

This project is a minimal Chrome extension built with Manifest V3.

It scans pages for:

- `input[type="text"]`
- `input[type="email"]`
- `input[type="tel"]`
- `textarea`

For each supported field, the extension adds a small `AI Fill` button next to the input. When clicked, it tries to determine the field prompt by checking:

1. A matching `label[for]`
2. The field placeholder
3. Nearby parent text
4. A default fallback prompt

The extension then sends that prompt to a local Ollama server at `http://localhost:11434/api/generate` using the `llama3.1:8b` model and fills the field with a realistic but fake answer.

## Files

- `manifest.json`: Chrome extension manifest and permissions
- `background.js`: Ollama request handling in the extension service worker
- `content.js`: Field detection, label extraction, button injection, and form filling
- `styles.css`: Minimal inline button styling
- `sample-test-page.html`: Local form page for manual testing

## Requirements

- Google Chrome with Developer Mode enabled
- Ollama running locally
- `llama3.1:8b` installed in Ollama

## Local Usage

1. Start Ollama with extension origins enabled.
2. Load this folder as an unpacked extension in Chrome.
3. Open `sample-test-page.html`.
4. Click `AI Fill` next to any supported field.

## Notes

- The extension is intended for local development and testing.
- Generated answers are fake and should not be used as truthful personal data.
- If Ollama blocks extension-origin requests, `OLLAMA_ORIGINS` must include `chrome-extension://*`.
