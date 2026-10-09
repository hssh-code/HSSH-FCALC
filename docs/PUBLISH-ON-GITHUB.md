# Publish LoadLens on GitHub

This guide puts the calculator online at:

**https://hssh-code.github.io/HSSH-FCALC/**

Anyone with the link can use it in a browser, and it can be installed as an app
from there (see [DESKTOP-APP.md](DESKTOP-APP.md)). The repository is public, so
GitHub Pages is free.

Everything is done in the GitHub website. No command line needed.

---

## Step 1: Make `main` the home branch

The code currently lives on the branch `claude/charming-archimedes-2172fe`.
The website publishes from `main`, which does not exist yet.

1. Open https://github.com/hssh-code/HSSH-FCALC
2. Click the **branch dropdown** (top left of the file list).
3. Type `main` in the box.
4. Click **Create branch main from claude/charming-archimedes-2172fe**.
5. Go to **Settings > General > Default branch**, click the switch icon,
   pick **main**, and confirm with **Update**.

> If `main` already exists later on, you instead merge new work into it with a
> **pull request**: open the **Pull requests** tab, click **New pull request**,
> choose `main` as the base and the work branch as compare, then **Merge**.

## Step 2: Turn on GitHub Pages

1. Go to **Settings > Pages**.
2. Under **Build and deployment > Source**, choose **GitHub Actions**.

That is the only setting. The workflow file `.github/workflows/pages.yml`
does the rest.

## Step 3: Publish

1. Open the **Actions** tab.
2. Click **Deploy web app** in the left list.
3. Click **Run workflow**, keep branch `main`, and click the green **Run workflow** button.
4. Wait about a minute for the green check mark.
5. Open https://hssh-code.github.io/HSSH-FCALC/

From now on, **every change that lands on `main` republishes the site
automatically**. You never need to repeat steps 1 to 3.

## Updating the calculator

- **Small edits in the browser:** open a file on GitHub, click the pencil icon,
  edit, then **Commit changes** to `main`. The site updates within a minute or two.
- **Edits on your computer:** use [GitHub Desktop](https://desktop.github.com)
  (no command line). **Clone** the repository, edit the files, open
  `index.html` to check your change, then **Commit** and **Push**.
- The **Tests** workflow runs on every push and checks the math. A red X on
  the commit means a test failed; click it to see which one.

## Tips

- **Browsers cache the site.** If a change does not show up, refresh once or
  twice. The app checks for a fresh copy every time it is online.
- **Custom domain (optional):** Settings > Pages > Custom domain, for example
  `loadlens.yourcompany.com`. GitHub shows the DNS record to add at your domain
  registrar. Tick **Enforce HTTPS** once it is available.
- **Repository name (optional):** the address uses the repository's name,
  `HSSH-FCALC`. To publish as `https://hssh-code.github.io/LoadLens/` instead,
  rename the repository in **Settings > General > Repository name** to `LoadLens`.
  GitHub redirects the old repository links, but the old Pages address stops
  working, so share the new one.
- **Saved data stays on each device.** Items people type and save are stored
  in their own browser, not on GitHub, so nothing shipment-related is uploaded.

## Something went wrong?

| What you see | What to do |
| --- | --- |
| Deploy fails with "Branch is not allowed to deploy to github-pages" | Make sure you ran the workflow on `main`, and that `main` is the default branch (Step 1). |
| Deploy fails with "Get Pages site failed" | Step 2 was skipped. Set Source to **GitHub Actions** and run it again. |
| Page shows 404 | Wait two minutes after the first deploy, then check the address ends with `/HSSH-FCALC/`. |
| Old version still showing | Hard refresh: Cmd+Shift+R on Mac, Ctrl+F5 on Windows. |
