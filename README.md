# Qin

A minimal, standalone desktop application for Linux designed for managing and interacting with LLM API endpoints. Built with React, Vite, and Electron, Qin features a sleek monochromatic aesthetic, low resource overhead, and local proxy routing.

---

## Features

* **Monochrome UI:** Clean, distraction-free interface built with React and Tailwind/GSAP.
* **Embedded Express Proxy:** Direct local API proxy routing built right into the desktop bundle.
* **Standalone Portability:** Packaged as a single, zero-dependency `.AppImage` binary.
* **Native Integration:** Includes custom desktop launcher support (`qin.desktop`) and high-resolution icons.
* **Local Storage:** Config and API keys persist securely on your local system (`~/.config/Qin/`).

---

## 🚀 Quick Start (AppImage)

1. Head over to the **[Releases](../../releases)** page and download `Qin-1.0.0.AppImage`.
2. Make the file executable:
   ```bash
   chmod +x Qin-1.0.0.AppImage


3. Launch Qin:

```bash
./Qin-1.0.0.AppImage

```

> **Note for Ubuntu / Debian / Fedora Users:** If your distribution does not support AppImages out of the box, ensure `libfuse2` is installed:
>
> ```bash
> # Ubuntu/Debian
> sudo apt install libfuse2
>
> # Fedora
> sudo dnf install fuse-libs
>
> ```

---

## 🛠️ Development Setup

If you want to clone and build Qin from source:

### Prerequisites

- **Node.js** (v18 or higher)
- **npm** or **pnpm**

### Installation

1. **Clone the repository:**

```bash
git clone https://github.com/amon1s/qin.git
cd qin

```

2. **Install dependencies:**

```bash
npm install

```

3. **Run in development mode:**

```bash
npm run dev

```

4. **Build the production AppImage:**

```bash
npm run dist

```

The compiled `.AppImage` binary will be generated in the `release/` directory.

---

## 📂 Project Structure

```text
qin/
├── assets/          # Application branding & window icons
├── public/          # Static web assets & fonts
├── src/             # React application, UI components, & styles
├── main.cjs         # Electron main process & local server launcher
└── package.json     # Electron-builder configuration & scripts

```

---

## 📄 License

MIT © [amon1s](https://www.google.com/search?q=https://github.com/amon1s)

```
