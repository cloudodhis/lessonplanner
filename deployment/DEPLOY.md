# Deploying to Hostinger

This folder is a ready-to-upload copy of the Lesson Planner app, configured to
run on **Hostinger's Node.js hosting** (available on Premium/Business Shared
Hosting and Cloud/VPS plans via hPanel).

> ⚠️ Ollama (local AI) only runs on your own computer — it cannot run on
> shared hosting. The deployed app uses the **Google AI Studio API**
> (free tier available) instead. Generation will work the same way for
> your visitors, just powered by the cloud instead of your PC.

---

## 1. Get a free Google AI API key

1. Go to https://aistudio.google.com/app/apikey
2. Sign in with a Google account and click **Create API key**
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
2. Edit `.env` and paste your Google AI API key:
   ```
   GOOGLE_API_KEY=your_actual_key_here
   AI_PROVIDER=google
   ```
   (You can edit this directly in hPanel's File Manager — click the file,
   then **Edit**.)

Alternatively, in the Node.js app screen in hPanel there's an
**Environment Variables** section — you can add `GOOGLE_API_KEY`,
`GOOGLE_MODEL`, and `AI_PROVIDER` there instead of using a `.env` file.

---

## 5. Install dependencies

Back in hPanel's Node.js app screen, click **Run NPM Install** (this reads
`package.json` and installs `express`, `dotenv`, and
`@google/generative-ai`).

---

## 6. Start / restart the app

Click **Restart** in the Node.js app screen. hPanel will start
`node server.js` for you and route your domain's traffic to it.

---

## 7. Test it

Visit your domain. The status badge in the header should show
**🤖 Google AI · gemini-2.0-flash**. Pick a template, fill in the form, and
click **Generate Plan** — you should see the lesson plan stream in.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Status badge says "No AI available" | Check `.env` has `GOOGLE_API_KEY` set and the app was restarted after editing it |
| "model ... is not found ... or is not supported for generateContent" | The `GOOGLE_MODEL` value isn't available for your key. Set `GOOGLE_MODEL=gemini-2.0-flash` (or `gemini-1.5-flash`) and restart |
| Page shows old content after re-uploading | Hard refresh the browser (Ctrl+Shift+R) — static files may be cached |
| 503 / app won't start | Confirm `server.js` is set as the startup file and `npm install` completed without errors |
