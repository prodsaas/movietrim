# MovieTrim

MovieTrim is a lightweight web application for fast, video trimming, audio selection, and subtitle embedding; using FFmpeg and FFprobe. Self-hosted, web-based video processing application built with SvelteKit and Node.js.

### Features

* **Extract Audio & Subtitle:** Automatically parses `.mp4`, `.mkv`, `.avi`, `.mov`, and `.webm` files to extract embedded audio and subtitle tracks.
* **Choose Audio & Subtitle:** Pick specific audio streams or subtitle tracks, or upload your own audio and subtitle files from your device.
* **Files Cleanup:** Automated old file deletion alongside immediate browser tab-closure cleanup endpoints.

## Prerequisites

On your local machine, ensure you have *FFmpeg* and *Node.js* installed.

### Debian / Ubuntu / Linux Mint / Pop!_OS
```bash
sudo apt install ffmpeg nodejs npm
```

### Fedora
```bash
sudo dnf install ffmpeg nodejs npm
```

### Arch Linux / Manjaro / EndeavourOS: 
```bash
sudo pacman -S ffmpeg nodejs npm
```

### RHEL / CentOS / Rocky Linux / AlmaLinux
```bash
sudo dnf install ffmpeg nodejs npm
```

### openSUSE
```bash
sudo zypper install ffmpeg nodejs npm
```

After installation finishes, verify both tools are working:
```bash
ffmpeg -version
node -v
npm -v
```

## Setup & Local Development

1. **Clone the repository and navigate to the project directory:**
   ```bash
   git clone https://github.com/prodsaas/movietrim.git
   cd movietrim
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```