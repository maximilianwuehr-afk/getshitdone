/**
 * Apps Script - Combined Gmail Search, Document Reading, and Doc Modification
 *
 * INSTRUCTIONS:
 * 1. Replace your Apps Script Code.gs with this file's contents.
 * 2. Update SHARED_SECRET to match your GetShitDone settings.
 * 3. Deploy -> Manage deployments -> Edit -> New version -> Deploy.
 */

const SHARED_SECRET = "mw-finn-vault-x7K9pL2m";

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // Secret check (skip for Gmail search which uses OAuth anyway)
    if (data.action !== "searchGmail" && data.secret !== SHARED_SECRET) {
      return ContentService.createTextOutput("Unauthorized").setMimeType(
        ContentService.MimeType.TEXT
      );
    }

    if (data.action === "searchGmail") {
      return handleGmailSearch(data);
    }

    if (data.action === "modifyDocText") {
      return handleDocModify(data);
    }

    if (data.fileId) {
      return handleDocRead(data);
    }

    return createJsonResponse({ success: false, error: "Unknown request" });
  } catch (err) {
    return createJsonResponse({ success: false, error: err.toString() });
  }
}

function handleGmailSearch(params) {
  const query = params.query;
  const maxResults = params.maxResults || 10;

  if (!query) {
    return createJsonResponse({ success: false, error: "No query provided" });
  }

  try {
    const threads = GmailApp.search(query, 0, maxResults);
    const emails = [];

    for (const thread of threads) {
      const messages = thread.getMessages();

      for (const message of messages) {
        const from = message.getFrom();
        const to = message.getTo();
        const subject = message.getSubject();
        const plainBody = message.getPlainBody();

        emails.push({
          messageId: message.getId(),
          from: from,
          to: to,
          subject: subject,
          snippet: plainBody.substring(0, 500),
          // Include full body (truncated to 3000 chars) for signature extraction
          body:
            plainBody.length > 3000
              ? plainBody.substring(0, 1500) +
                "\n...\n" +
                plainBody.substring(plainBody.length - 1500)
              : plainBody,
          date: message.getDate().toISOString(),
          threadId: thread.getId(),
        });

        // Only take the most recent message per thread for brevity
        break;
      }
    }

    return createJsonResponse({
      success: true,
      emails: emails,
      count: emails.length,
    });
  } catch (error) {
    return createJsonResponse({ success: false, error: error.toString() });
  }
}

function handleDocModify(data) {
  const fileId = (data.fileId || "").trim();
  const text = String(data.text || "");
  const mode = (data.mode || "append").toLowerCase();

  if (!fileId || !text) {
    return createJsonResponse({ success: false, error: "Missing fileId or text" });
  }

  try {
    const doc = DocumentApp.openById(fileId);
    const body = doc.getBody();

    if (mode === "replace") {
      body.clear();
      appendTextAsParagraphs_(body, text);
    } else if (mode === "prepend") {
      insertTextAtTop_(body, text);
    } else {
      appendTextAsParagraphs_(body, text);
    }

    doc.saveAndClose();
    return createJsonResponse({ success: true });
  } catch (error) {
    return createJsonResponse({ success: false, error: error.toString() });
  }
}

function handleDocRead(data) {
  const fileId = data.fileId;

  if (!fileId) {
    return ContentService.createTextOutput("No fileId provided").setMimeType(
      ContentService.MimeType.TEXT
    );
  }

  const file = DriveApp.getFileById(fileId);
  const mimeType = file.getMimeType();
  let text = "";

  if (mimeType === MimeType.GOOGLE_DOCS) {
    const doc = DocumentApp.openById(fileId);
    text = doc.getBody().getText();
  } else if (mimeType === MimeType.GOOGLE_SHEETS) {
    const sheet = SpreadsheetApp.openById(fileId).getSheets()[0];
    text = sheet
      .getDataRange()
      .getValues()
      .map((row) => row.join(", "))
      .join("\n");
  } else if (mimeType === MimeType.PLAIN_TEXT) {
    text = file.getBlob().getDataAsString();
  } else {
    text = `[File type ${mimeType} not supported for direct text extraction. Link: ${file.getUrl()}]`;
  }

  if (text.length > 5000) text = text.substring(0, 5000) + "... [truncated]";

  return createJsonResponse({ success: true, text: text });
}

function insertTextAtTop_(body, text) {
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    body.insertParagraph(0, lines[i]);
  }
}

function appendTextAsParagraphs_(body, text) {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    body.appendParagraph(line);
  }
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function doGet(e) {
  return ContentService.createTextOutput(
    JSON.stringify({
      status: "OK",
      message: "Gmail & Docs API is running",
      endpoints: ["searchGmail", "readDoc", "modifyDocText"],
    })
  ).setMimeType(ContentService.MimeType.JSON);
}
