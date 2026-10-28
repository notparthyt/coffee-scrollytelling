# More Than Coffee

A cinematic coffee-shop landing page built around a scroll-controlled sequence of existing image frames. The site uses a single global frame timeline, a responsive canvas, a searchable menu, and a lightweight local cart.

**Live website:** [https://notparthyt.github.io/coffee-scrollytelling/](https://notparthyt.github.io/coffee-scrollytelling/)

## About

The hero follows a visual journey from a cafe exterior through the interior and into coffee preparation. The frame folders are joined in order (`part1` through `part5`) into one sequence; frame numbering restarts inside each folder, but the playback index does not.

The site is a static project: no backend, account, payment, or build service is required. The cart is a front-end demo saved in the browser's local storage and does not submit orders or process payments.

## Quick setup

Requirements: Python 3 (for the local web server). Node.js is optional.

1. Clone or download this repository.
2. From the project root, start a local server:

   ```sh
   python -m http.server 8000
   ```

3. Open <http://localhost:8000>.

Do not open `index.html` directly from the file system; browser module and data requests require HTTP.

### Regenerate the frame manifest

The checked-in manifest is ready to use. If you add, remove, or rename source frames, regenerate it from the project root:

```sh
python scripts/build-frame-manifest.py
```

The script discovers images from `Frames/part1` to `Frames/part5`, sorts numeric frame suffixes naturally, and writes `js/frame-manifest.js`. It does not modify source frames.

## Project structure

```text
.
├── Frames/                 # Existing source frames (part1–part5)
├── css/main.css            # Layout, responsive styling, and theme
├── data/products.json      # Editable sample menu data
├── js/
│   ├── frame-manifest.js   # Generated, ordered global frame sequence
│   └── main.js             # Canvas playback, scroll behavior, menu, and cart
├── scripts/
│   └── build-frame-manifest.py
├── index.html
└── README.md
```

## Public use and licensing

The project source code is available for free use under the [MIT License](./LICENSE). You may reuse and adapt the code in accordance with that license.

**The MIT license does not cover the supplied frame/video assets, product photography, fonts, or third-party libraries.** Their rights and terms remain with their respective owners. Verify that you have permission to reuse or redistribute any such assets before publishing a modified copy. The `zip/` and `video/` source folders are intentionally excluded from this repository; the extracted frames in `Frames/` are included because the website depends on them.

## Credits

Created by **@notparthyt**

- Instagram: [@notparthyt](https://www.instagram.com/notparthyt/)
- Discord: [@notparthyt](https://discord.com/)
- YouTube: [@notparthyt](https://www.youtube.com/@notparthyt)

The visual direction is original and uses the supplied project footage. GSAP and ScrollTrigger are loaded from cdnjs; fonts are loaded from Google Fonts; sample menu photography is loaded from Unsplash. Those services and assets retain their own terms.

## GitHub Pages deployment

This repository includes a GitHub Actions workflow that publishes the static site to GitHub Pages. It publishes only the website and required frames, never the `zip/` or `video/` directories.

1. In the GitHub repository, open **Settings → Pages** and set the source to **GitHub Actions** if it is not already selected.
2. Push to the `main` branch or run the **Deploy to GitHub Pages** workflow manually from the **Actions** tab.
3. After the workflow succeeds, GitHub Pages displays the public URL in **Settings → Pages**.

GitHub Pages is available at no additional charge for public repositories under GitHub's standard usage terms. Availability and account limits are controlled by GitHub.

## Notes

- The five parts contain 823 source frames (181 + 181 + 181 + 181 + 99).
- All supplied frame images are 1920 × 1080 JPGs.
- A directory listing is not required in production; the static manifest contains explicit paths.
- Browser performance depends on network and device capabilities because the source frames are full-resolution images.
