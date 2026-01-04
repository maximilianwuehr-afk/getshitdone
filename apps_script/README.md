# GetShitDone Apps Script

This folder contains the Apps Script code used by the GetShitDone plugin for:
- Gmail search
- Google Docs reading
- Google Docs modification (prepend/append/replace)

## Setup

1. Open your Apps Script project in Google Apps Script.
2. Replace the contents of `Code.gs` with `apps_script/Code.gs`.
3. Update `SHARED_SECRET` to match your GetShitDone plugin settings.
4. Deploy:
   - **Deploy → Manage deployments → Edit**
   - **New version → Deploy**

## Required Plugin Settings

In Obsidian → GetShitDone settings:
- **Apps Script URL**: your deployment URL
- **Apps Script Secret**: same as `SHARED_SECRET`

## Supported Endpoints

The script expects POST JSON:
- `action: "searchGmail"` with `{ query, maxResults }`
- `action: "modifyDocText"` with `{ fileId, secret, text, mode }`
- `fileId` (without action) for document read

## Notes

- `modifyDocText` supports `mode`: `prepend` (default in plugin), `append`, `replace`
- For O3 prep, the plugin uses **prepend** to keep the newest week on top
