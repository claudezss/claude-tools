# sysmon

Shows CPU, RAM, GPU and GPU RAM usage, with the totals behind them, in Claude Code's status line, refreshed every few seconds:

```
CPU 12% (8 cores) · RAM 48% (7.7/16.0 GB) · GPU 30% (1 GPU) · GPU RAM 21% (5.0/24.0 GB)
```

Cores are logical cores; GB are GiB, as the OS tools report them.

GPU fields appear only when a GPU is found.

The Claude apps (desktop, web, mobile) don't show a plugin's status line, so `/sysmon` also opens a live **System monitor** pane with a colored bar per value. Where the client draws nothing at all (a cloud session viewed in the app), `/sysmon` replies with the current reading instead.

| Command | |
| --- | --- |
| `/sysmon` | Open the pane (and start sampling if it was off) |
| `/sysmon off` | Stop sampling, clear the status line, close the pane |
| `/sysmon on` | Start sampling again, status line only |

## Install

```
/plugin install sysmon --marketplace claudezss/claude-tools
```

## Where the numbers come from

| | CPU | RAM | GPU / GPU RAM |
| --- | --- | --- | --- |
| **Linux** | `/proc/stat` (busy time between samples) | `/proc/meminfo` (`MemTotal − MemAvailable`) | `nvidia-smi`; else AMD's `/sys/class/drm/card*/device` (`gpu_busy_percent`, `mem_info_vram_*`) |
| **macOS** | `top -l 2 -n 0 -s 1` | `vm_stat`, counted as Activity Monitor does (app + wired + compressed) | `ioreg` `IOAccelerator` stats. Apple silicon shares system memory, so GPU RAM is the GPU's share of it |
| **Windows** | `Win32_Processor.LoadPercentage` | `Win32_OperatingSystem` | `nvidia-smi`; else the GPU performance counters (busiest engine, as Task Manager shows it; dedicated memory against the adapter's size) |

On Windows one PowerShell process runs for the whole session and prints a sample per interval, so the monitor doesn't start a new PowerShell every few seconds. Nothing runs in headless sessions (`claude -p`).

Multiple NVIDIA GPUs show average utilization and pooled memory; on macOS with two GPUs, the busier one's utilization and the discrete GPU's VRAM.

## Options

| Option | Default | |
| --- | --- | --- |
| `intervalSeconds` | `5` | How often to sample (minimum 2) |

Set it from `/config`, or in `settings.json` under `pluginConfigs.sysmon.options`.
