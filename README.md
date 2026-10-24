# Embrace

A shepherding visit tracker for the body of elders. Every elder signs in with his own Google account, logs visits with notes, and sees the whole flock sorted so whoever has waited longest is at the top. Regular pioneers, elders, ministerial servants and appointed wives are prioritized. Everything syncs live across iPhone and Android.

Embrace is an installable web app: elders open the link once, tap **Add to Home Screen**, and from then on it opens full-screen from its own icon like any other app. No App Store needed.

## What's in here

| Path | What it is |
| --- | --- |
| `public/` | The app itself (HTML, CSS, JavaScript, icons). |
| `public/firebase-config.js` | Where your Firebase settings go. While empty, the app runs in preview mode on one device. |
| `firestore.rules` | Security rules: only elders on the list can read or write anything. |
| `firebase.json` | Hosting settings. |
| `.github/workflows/deploy.yml` | Publishes the app to Firebase Hosting every time `main` changes. |

**The publisher list is never stored in this repository.** You import it inside the app (Settings › Import a publisher list), and it lives only in your Firebase database, behind the elders-only rules.

## One-time setup

### 1. Create the Firebase project (Google)
1. Go to <https://console.firebase.google.com> and sign in with the Google account that will own Embrace.
2. **Add project** › name it `embrace-shepherding`. Google Analytics is not needed. Note the **project ID** it shows (it may add numbers at the end).
3. **Build › Authentication › Get started › Google** › Enable › Save.
4. **Build › Firestore Database › Create database** › pick the location closest to you › **Start in production mode**.
5. **Firestore › Rules** tab › replace everything with the contents of `firestore.rules` › **Publish**.
6. **Project settings (gear) › Your apps › Web (`</>`)** › nickname `Embrace` › Register. Copy the `firebaseConfig` block into `public/firebase-config.js`.

### 2. Add yourself as the first admin
In **Firestore › Data**: **Start collection** › Collection ID `elders` › Document ID = your Gmail address in lowercase › add two fields:
- `name` (string): your name
- `admin` (boolean): `true`

After that, add the other elders from inside the app (Settings › Add an elder).

### 3. Automatic publishing from GitHub
1. Firebase console › **Project settings › Service accounts › Generate new private key**. A `.json` file downloads. Keep it private.
2. GitHub repo › **Settings › Secrets and variables › Actions › New repository secret** › Name `FIREBASE_SERVICE_ACCOUNT` › paste the entire contents of that file › Save. Then delete the file from your computer.
3. If your project ID is not exactly `embrace-shepherding`, change it in `.firebaserc` and in `.github/workflows/deploy.yml`.
4. Push to `main` (or run the **Deploy Embrace** workflow from the Actions tab). The app goes live at `https://<project-id>.web.app`.

### 4. Load the congregation
Open the app, sign in, go to **Settings › Import a publisher list (CSV)** and pick the roster file. Columns: `group, meeting_place, name, status, rank, appointed_wife, note`. Only `name` is required. `rank` is one of Elder, Ministerial Servant, Regular Pioneer, Auxiliary Pioneer, Publisher, Inactive, Removed. `appointed_wife` is `yes` or blank.

### 5. Hand it to the elders
Send each elder the link. On iPhone: open it in **Safari** › Share › **Add to Home Screen**. On Android: open it in **Chrome** › ⋮ menu › **Add to Home screen** (or **Install app**). They sign in with the Gmail address you added for them.

## How it decides who's next
- **Priority** = elders, ministerial servants, regular pioneers and appointed wives who are active.
- Inside each section: never visited first, then whoever has waited the longest.
- A publisher turns orange after the "Overdue after" period in Settings (default 6 months).
- "Needs follow-up" on a visit puts that publisher on the Activity tab until the next visit.
- The Activity tab counts visits by each elder for the current service year (September–August).

## Privacy
- Only Google accounts listed in `elders` can read or write any data; this is enforced by the database itself, not just the app.
- An elder can delete visits he logged. Admins can delete any visit, remove publishers and manage the elders list.
- Visit notes never leave the database except to the phones of elders on the list.
- Removing an elder from the list cuts off his access immediately.
