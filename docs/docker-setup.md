# Getting Docker to start

The engine runs inside Docker (or Podman on Linux). When Docker won't start, it's almost always one of these:
- virtualization is switched off in the BIOS;
- Windows' Linux layer (WSL) is missing;
- your account isn't allowed to use Docker yet.

Work down the section for your system.

## Windows

### 1. Check whether virtualization is on

Open Task Manager (Ctrl+Shift+Esc), then **Performance** → **CPU**. Under the graph it says **Virtualization: Enabled**
or **Disabled**. If it says Enabled, skip to step 3.

### 2. Turn virtualization on in the BIOS/UEFI

1. Get into the BIOS/UEFI settings, either way:
   - Hold **Shift** while clicking **Restart**. Then choose **Troubleshoot** → **Advanced options** → **UEFI Firmware
     Settings** → **Restart**.
   - Or press **Del**, **F2** or **F10** right as the PC starts. The key depends on the brand: HP is usually F10,
     Dell and Lenovo F2, most custom-built PCs Del.
2. Turn the setting on. It's usually under **Advanced**, **CPU Configuration** or **Overclocking (OC)**:
   - AMD processor: **SVM Mode** → **Enabled**.
   - Intel processor: **Intel Virtualization Technology** (also called **VT-x**) → **Enabled**.
3. Save and exit (usually **F10**), and let Windows start.
4. Check Task Manager again: it should now say Virtualization: Enabled.

### 3. Install Windows' Linux layer (WSL) from an administrator terminal

1. Open an **administrator** terminal:
   - right-click the Start button and choose **Terminal (Admin)** (on Windows 10: **Windows PowerShell (Admin)**);
   - or open Start, type `PowerShell`, right-click it and choose **Run as administrator**.

   Click **Yes** when Windows asks. The window title should start with "Administrator".
2. Run:

   ```powershell
   wsl --install --no-distribution
   ```

   Then restart the PC. Docker brings its own Linux, so you don't need Ubuntu.
3. If Docker still complains after the restart, run these two in the administrator terminal, then restart again:

   ```powershell
   dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
   dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
   ```

4. If it says WSL is out of date, run:

   ```powershell
   wsl --update
   ```

5. If Task Manager shows Virtualization: Enabled but Docker still says it's off, Windows' hypervisor may have been
   switched off, often by an old emulator or anti-cheat setup. Run this, then restart:

   ```powershell
   bcdedit /set hypervisorlaunchtype auto
   ```

### 4. Let your account use Docker

Docker Desktop's installer adds you to the **docker-users** group. That only counts after you sign out of Windows
and back in, or restart.

If Docker says you're not allowed, run this in the administrator terminal, then sign out and back in:

```powershell
net localgroup docker-users "$env:USERNAME" /add
```

### 5. Start Docker Desktop once

Open it from the Start menu and finish its first screens (sign-in is optional). Wait until it says
**Engine running**. The first start can take a few minutes.

## Mac

- **No BIOS step.** Virtualization is always on: Apple Silicon Macs and Intel Macs both have it built in, and nothing
  can turn it off.
- **Install:** download Docker Desktop for your chip from <https://www.docker.com/products/docker-desktop/>:
  - **Apple Silicon** (M1 or newer: Apple menu → About This Mac says "Chip Apple M…");
  - **Intel** (it says "Processor Intel…").

  Drag it to Applications and open it. It asks for your Mac password once, to install its helper. Say yes; that is
  the Mac's version of "run as administrator".
- **Apple Silicon:** in Docker Desktop → **Settings** → **General**, turn on **Use Rosetta for x86_64/amd64 emulation
  on Apple Silicon** (macOS 13 or newer). The engine is built for Intel, and without Rosetta it is very slow.
- **If it won't start:**
  - Check that macOS is 12 or newer.
  - Quit Docker Desktop and open it again.
  - Still stuck: Docker Desktop → Troubleshoot (the bug icon) → **Restart**, or **Reset to factory defaults**.
  - In a terminal (Applications → Utilities → Terminal), `docker info` should print a page about the engine, not
    an error.

## Linux (and the Steam Deck)

- **Steam Deck:** nothing to install and no BIOS step. Podman is built into SteamOS 3.5 or newer. In Desktop Mode,
  open Konsole and check:

  ```bash
  podman info
  ```

  It should print a page about the host, not an error.
- **Other Linux, the easy way: Podman or Docker Engine.** Neither needs virtualization, because both run containers
  directly on Linux.
  - Install one from your distribution, for example:

    ```bash
    sudo apt install podman
    ```

    or

    ```bash
    sudo apt install docker.io
    ```

  - For Docker Engine, `sudo` is Linux's "run as administrator". Start it and let your account use it:

    ```bash
    sudo systemctl enable --now docker
    ```

    ```bash
    sudo usermod -aG docker "$USER"
    ```

    Then sign out and back in. Check with `docker info`.
- **Docker Desktop for Linux** is the one that does need virtualization, because it runs a small virtual machine
  (KVM).
  - Turn on SVM or VT-x in the BIOS exactly as in the Windows steps above.
  - Then check that KVM is there and that you may use it:

    ```bash
    ls -l /dev/kvm
    ```

    ```bash
    sudo usermod -aG kvm "$USER"
    ```

    Sign out and back in after the second one.
  - If `/dev/kvm` is missing even with virtualization on, load the module: `sudo modprobe kvm_amd` (AMD) or
    `sudo modprobe kvm_intel` (Intel).

## Still stuck

Send the host the first error message Docker shows, and the output of `docker info` (or `podman info` on Linux).
