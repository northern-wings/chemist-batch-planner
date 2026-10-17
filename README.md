# North's Chemist Batch Planner
A batch planner for chemists on legacy Funky Station (SS14). Pick what Medbay needs and it works out the order of batches, which beaker or jug each one goes in, the heat plan, the dispenser button presses, and what to grind or bring to the bench. The Chemist, Medicine, Reactions, SOP and other guidebook pages are built in so nobody has to flip between the guidebook and a browser.

Everything it knows (reagents, reactions, guidebook text, microwave recipes, grinder and juicer sources, sprites) is read straight from the Funky Station repository. The footer of the app shows which Funky commit and date it was last synced to.

# Mixes tab
Builds one jug that holds several finished medicines at fixed ratios (for example Libital + Probital for brute, or Arithrazine 3 : Libital 1 for radiation). It shows the amount of each in the container, how much of each goes in one shot, how many shots fit under every overdose limit, what each medicine does and its side effects, warns when two of the chemicals would react if they meet (such as Puncturase with Lacerinol making Razorium), and writes a short label for the jug. "Add this jug to the order list" sends the amounts to the Planner so the batches get worked out. The starting mixes are modelled on the recommended mixes in [segaswolf's Funky chem guide](https://segaswolf.github.io/funky-chemist-guide/); every number is recalculated from Funky's own files.

# Use it as an app

The app itself lives in the `docs/` folder.

**Install from the browser (works on Windows, Android, iPhone, Mac)**
1. Turn on GitHub Pages once: repo **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/docs` → Save**.
2. Open `https://northern-wings.github.io/chemist-batch-planner/` in Chrome or Edge.
3. Click the install icon in the address bar (or menu → **Install Chemist's Batch Planner**). Phones: menu → **Add to Home screen**.

It works offline after the first visit and picks up updates the next time you open it online.

**Windows program (.exe)**
1. On GitHub: **Releases → Draft a new release**, type a tag like `v1.0`, click **Publish release**.
2. Wait about 5–10 minutes (the **Actions** tab shows progress). Two files appear on the release page: `…setup.exe` (installer) and `Chemist-Batch-Planner-portable.exe` (just run it).
3. Windows may show a blue "Windows protected your PC" box because the app isn't code-signed: **More info → Run anyway**.

The .exe does not update itself. After you change the app or re-sync the data, publish a new release (`v1.1`, …) and download the new file.

# Updating the recipes from Funky
On GitHub: **Actions → Sync Funky data → Run workflow**. It re-reads the Funky repository, rebuilds `docs/index.html`, and commits it only if something changed. Then pull in GitHub Desktop (and publish a new release if you want a new .exe).

Things the sync cannot do by itself: new UI features, new sprites for items that aren't already listed in `tools/sparse.txt`, and new guidebook pages (the page list is in `tools/gbsel.json`). Ask Claude for those.

# Folder map
* `docs/index.html` – the whole app in one file (generated: do not edit by hand)
* `docs/manifest.webmanifest`, `docs/sw.js`, `docs/icons/`, `docs/fonts/` – install and offline support (fonts are bundled, SIL Open Font License)
* `tools/` – the data pipeline and the app's source (`app.src.html`, `engine.js`); `sync.py` runs it
* `src-tauri/`, `package.json`, `.github/workflows/release.yml` – the Windows build

# Credits
Reagent, reaction, guidebook and sprite data come from [Funky Station](https://github.com/funky-station/funky-station) (and the Space Station 14 projects it builds on). Each sprite's copyright and licence line is listed in the app's credits panel.
