# Deploying to Hostinger

This folder is a ready-to-upload copy of the Lesson Planner app, configured to
run on **Hostinger's Node.js hosting** (available on Premium/Business Shared
Hosting and Cloud/VPS plans via hPanel).

> ⚠️ Ollama (local AI) only runs on your own computer — it cannot run on
> shared hosting. The deployed app uses the **Claude API (Anthropic)**
> as its primary provider. Generation will work the same way for
> your visitors, just powered by the cloud instead of your PC.

---

## 1. Get a Claude (Anthropic) API key

1. Go to https://console.anthropic.com
2. Sign in, add billing details, and create an API key under **API Keys**
3. Copy the key — you'll paste it in step 4 below

---

## 2. Set up the Node.js app in hPanel

1. Log in to **hPanel** → go to **Advanced → Node.js** (or **Website → Node.js**)
2. Click **Create Application** and configure:
   - **Node.js version:** 18 or higher
   - **Application root:** the folder you'll upload these files to
     (e.g. `lesson-planner`)
   - **Application URL:** the domain or subdomain you want the app on
   - **Application startup file:** `server.js`
3. Click **Create**

---

## 3. Upload the files

Upload **everything in this `deployment` folder** (except `node_modules`,
which doesn't exist yet) into the Application root you set above. You can do
this with:

- hPanel **File Manager** → upload as a zip, then extract, **or**
- **FTP/SFTP** (credentials available in hPanel → Files → FTP Accounts)

Make sure `server.js`, `package.json`, and the `public/` folder all end up
directly inside the application root.

---

## 4. Add your API key

1. Rename `.env.example` to `.env`
2. Edit `.env` and paste your Claude API key:
   ```
   ANTHROPIC_API_KEY=your_actual_key_here
   AI_PROVIDER=claude
   ```
   (You can edit this directly in hPanel's File Manager — click the file,
   then **Edit**.)

Alternatively, in the Node.js app screen in hPanel there's an
**Environment Variables** section — you can add `ANTHROPIC_API_KEY`,
`CLAUDE_MODEL`, and `AI_PROVIDER` there instead of using a `.env` file.

---

## 5. Install dependencies

Back in hPanel's Node.js app screen, click **Run NPM Install** (this reads
`package.json` and installs `express`, `dotenv`, `@anthropic-ai/sdk`, and
`@google/generative-ai`).

---

## 6. Start / restart the app

Click **Restart** in the Node.js app screen. hPanel will start
`node server.js` for you and route your domain's traffic to it.

---

## 7. Test it

Visit your domain. The status badge in the header should show
**✨ Claude · claude-sonnet-4-6**. Pick a template, fill in the form, and
click **Generate Plan** — you should see the lesson plan stream in.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Status badge says "No AI available" | Check `.env` has `ANTHROPIC_API_KEY` set and the app was restarted after editing it |
| "authentication_error" / 401 | Your `ANTHROPIC_API_KEY` is missing, wrong, or billing isn't set up on console.anthropic.com |
| "model: not_found_error" | The `CLAUDE_MODEL` value isn't available for your account. Try `claude-sonnet-4-6` or `claude-haiku-4-5-20251001` |
| Page shows old content after re-uploading | Hard refresh the browser (Ctrl+Shift+R) — static files may be cached |
| 503 / app won't start | Confirm `server.js` is set as the startup file and `npm install` completed without errors |

---

## Optional: fall back to Google AI Studio

If you'd rather not use Claude, set `AI_PROVIDER=google` and
`GOOGLE_API_KEY` (free tier at https://aistudio.google.com/app/apikey)
instead — the app supports both.
