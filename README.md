# Embrace

A simple shepherding visit tracker for the body of elders. Tap **Log a Visit**, find the name, pick who went with you and the day, add notes, and save. Everyone is listed with whoever has waited longest at the top; regular pioneers, elders, ministerial servants and appointed wives come first. Every elder's phone updates within a second of a visit being saved.

Embrace is an installable web app for iPhone and Android: open the link once, tap **Add to Home Screen**, and it opens full-screen from its own sheep icon.

## How elders get in
1. The first time Embrace opens on a phone, it asks for the **4-digit congregation code**.
2. Then it asks **"Who are you?"** and lists everyone marked Elder. The brother taps his name, and the phone remembers him.

The code is never stored in this repository. The first phone to open the connected app creates it, and it lives only in the Firebase database, where no phone can read it back.

## Google (Firebase) setup — one time, about 10 minutes
1. Go to <https://console.firebase.google.com>, sign in with your Google account, **Create a project** named `embrace-shepherding`. Google Analytics is not needed.
2. **Build › Authentication › Get started › Sign-in method › Anonymous › Enable › Save.**
3. **Build › Firestore Database › Create database** › choose the location nearest you › **Start in production mode**.
4. **Firestore › Rules** tab › delete what's there › paste the contents of `firestore.rules` › **Publish**.
5. **Project settings** (gear icon) › **Your apps** › **Web `</>`** › nickname `Embrace` › **Register app**. Copy the `firebaseConfig` block into `public/firebase-config.js`. (Done: project `embrace-shepherding-bdb89`.)

## Publishing (GitHub Pages)
1. GitHub repo › **Settings › Pages** › under **Build and deployment**, set **Source** to **GitHub Actions**.
2. Every push to `main` publishes the app to **https://jwmap3.github.io/EMBRACE/**. You can also run **Publish Embrace** from the Actions tab.

The repository holds only the app's code. No names, notes or codes are ever stored here.

## First run
1. Open the app link, create the 4-digit code, and on "Who are you?" tap **My name is not here** and find your name (or type it).
2. **Settings › Import a list (CSV)** and pick the roster file.
3. Open each elder, ministerial servant, regular pioneer and appointed wife, tap **Edit**, and set their privilege.
4. Send the link and the code to the other elders.

## How the order works
- **Who's next** shows pioneers and appointed first, then publishers, then inactive and removed ones.
- Within each section: never visited first, then whoever has waited the longest. Saving a visit moves that person down.
- Names turn orange after the **Overdue after** period in Settings (default 6 months).
- **Needs a follow-up** on a visit lists that person on the Visits tab until the next visit.

## Privacy
- Nothing can be read until a phone enters the congregation code; the database enforces this, not just the app.
- The publisher list and notes never go into this repository. Keep CSV files out of it (`.gitignore` already blocks them).
- To lock out new phones, change the code in Settings.
