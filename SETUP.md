# Fit study: setup

The study runs as one web page (`index.html`, hosted free on GitHub Pages) that sends answers and photos to a
Google Sheet and a Drive folder in **bradley.noelani@gmail.com** through a small Google Apps Script
(`apps_script/Code.gs`). Participants never sign in.

```
participant ──> index.html (GitHub Pages) ──> Apps Script web app ──> Sheet (answers) + Drive folder (photos)
                 ?pid=…  for part 2      <──  lists for that pid   <──  "lists" tab (filled by the researcher)
```

- Part 1: `https://noe-beee.github.io/fit-study/`
- Part 2: `https://noe-beee.github.io/fit-study/?pid=<code>` (the code is created at part 1)
- Test mode, nothing is sent: add `?demo` (part 1) or `?demo&part=2` (part 2 with example shirts)

## 1. Google Sheet and script (about 10 minutes)

1. Signed in as **bradley.noelani@gmail.com**, create a new Google Sheet, e.g. "Fit study data".
2. **Extensions → Apps Script.** Delete the example code, paste all of `apps_script/Code.gs`, save.
3. Back in the Sheet, reload the page. A **Study** menu appears. Choose **Study → Set up tabs and photo folder**.
   Google asks for permission (Sheets, Drive, Gmail): allow it. On "Google hasn't verified this app", choose
   *Advanced → Go to … (unsafe)*: it's your own script.
   This creates the tabs `part1`, `contacts`, `participants`, `lists`, `part2`, `screenouts` and the Drive folder
   "Fit study photos".

## 2. Publish the script as a web app

1. In the Apps Script editor: **Deploy → New deployment → type: Web app**.
2. *Execute as:* **Me**. *Who has access:* **Anyone**. Deploy.
3. Copy the **Web app URL** (ends in `/exec`).
4. Paste it into `index.html`, at the top of the script: `API: "https://script.google.com/macros/s/…/exec"`.

After a later change to `Code.gs`: **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL stays
the same.

## 3. GitHub Pages (personal account Noe-beee only)

1. A **public** repository `fit-study` under **Noe-beee**, containing `index.html` (and this folder's other files).
   It holds only the page code; no participant data is ever in the repository.
2. Repository **Settings → Pages → Deploy from a branch → main / (root)**.
3. After a minute the page is at `https://noe-beee.github.io/fit-study/`.

## 4. Test before the pilot

1. Open the page with `?demo` on your phone and click through both parts.
2. Do one real part 1 yourself (without `?demo`). Check: a row in `part1`, your e-mail only in `contacts`, a row in
   `participants` with a pid and order, the photos in "Fit study photos", and a notification e-mail.
3. Fill `lists` for your pid (step 5), open `…/?pid=<your pid>`, complete part 2, and check the `part2` row.
4. Delete your test rows and photos before the pilot.

## 5. Each participant

1. **Notification e-mail** "New part 1 submission: <pid>". Download the photos from the Drive folder (names start with
   the pid) and run intake.
2. **Lists:** paste 20 rows into the `lists` tab: 10 with `source = model`, 10 with `source = popularity`.

   | pid | source | rank | product_id | brand | name | price | img_packshot | img_model |
   |---|---|---|---|---|---|---|---|---|
   | k7f3q9ab | model | 1 | 00E21D00B-Q11 | Vero Moda | Basic T-shirt | 19.99 | https://img01.ztat.net/… | https://img01.ztat.net/… |

   The page shows each list in `rank` order. Which list appears as A or B comes from the `order` column in
   `participants` (set at random at part 1). The page never receives the source.
3. Select the participant's row in `participants` and choose **Study → Send part 2 link to the selected participant**.
   The e-mail text is shown for confirmation before it is sent (edit it at the top of `Code.gs`).
4. After the features are checked: **Study → Delete photos of the selected participant**, then empty the Drive trash.
5. Part 2 answers arrive in `part2`, with `list_A_source` / `list_B_source` already filled in.

## 6. What is stored where

| What | Where | When it goes |
|---|---|---|
| Answers (no name, no e-mail) | `part1`, `part2` tabs | kept for the thesis |
| E-mail address | `contacts` tab only | delete after the study (and try-on contact) |
| Photos | Drive folder "Fit study photos" | deleted after the features are checked |
| Screen-outs | `screenouts` tab: reason and date only | kept for the participant flow diagram |

The page shrinks photos to 2000 px and re-encodes them, which also drops their metadata (e.g. location). It loads no
third-party fonts or trackers. iPhone HEIC photos that the browser can't open (Chrome, Firefox, Android) are
converted in the browser by `vendor/heic2any.min.js` (heic2any 0.0.4, MIT), served from this site and loaded only when needed. Shirt images load from the shop's image server.

## Variables

Part 1: `consent`, `elig_*`, `width_cm`, `length_cm`, `size_label`, `worn_way`, `shop_url`, `ref_fit` (1–7),
`ref_fit_desc`, `ref_price`, `colpref`, `colfams`, `age`, `height_cm`, `size_usual`, `fit_pref`, `spend`,
`online_items`, `online_returns`, `rank_<aspect>` (1–3), `why_like`, `photos`, timings `t_<screen>_s`, `t_total_s`,
`device`.

Part 2, per list L = A/B: `tick_L` (positions 1–10, "; "-separated), `chosen_L` (position), `chosen_L_product`,
`colourhid_L`, `h1_L_1..3`, `h2_L` (single item, 1 = very unlikely … 7 = very likely), `h3_L_1..3`, `h4_L_1` (expected
return), `h4_L_2` (would order a second size: bracketing) (all 1–7, raw; in analysis H1 items 2–3 and H3 item 1 are
reverse-scored; the two H4 items are reported separately), `barrier_L` ("; "-separated; "none" when left blank), `barrier_other_L` (text, only when Other is ticked), `fam_brand_L`, `fam_seen_L`; then `pref_fit`, `pref_overall`, `why_list`,
`other`, `tryon`, timings, `device`, plus `order`, `list_A_source`, `list_B_source` added by the script.
