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

### Option 1: Run Instantly via Docker Hub

```bash
docker run -d -p 5000:5000 prodsaas/movietrim:latest
```

### Option 2: Run Locally from Source

1. **Clone the repository:**
   ```bash
   git clone https://github.com/prodsaas/movietrim.git

   cd movietrim
   ```

2. **Choose your method:**

   * **Method A: Run via npm**
      ```bash
      npm install

      npm run dev
      ```

   * **Method B: Run via Docker**
      ```bash
      docker build -t movietrim .

      docker run -p 5000:5000 --name movietrim-app movietrim
      ```

## Publishing on Docker Hub

1. **Log in to Docker Hub**
   ```bash
   docker login
   ```

2. **Build and tag the image with your Docker Hub username**
   ```bash
   docker build -t YOUR_DOCKER_HUB_USERNAME/movietrim:latest .
   ```

3. **Push the image to Docker Hub**
   ```bash
   docker push YOUR_DOCKER_HUB_USERNAME/movietrim:latest
   ```