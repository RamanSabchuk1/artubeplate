#!/usr/bin/env python3
"""Synthesize the showcase's placeholder sound effects into the template's raw-assets.

Every sound is generated from sine waves, filtered noise and envelopes, so there is no sample
library and no licence to track. They are written as WAV into raw-assets/audio{m}/<bus>/, where the
asset pipeline encodes them to WebM (Opus) + MP3. The folder is the bus; `name.1.wav`,
`name.2.wav`… are variants of `name`.

    python3 tools/sfx/make_sfx.py [template_dir]

Default template_dir: packages/create-artubeplate/template. Needs numpy.
"""

import os
import sys
import wave

import numpy as np

RATE = 44100
RNG = np.random.default_rng(7)  # fixed seed: the same files on every run


def t(seconds):
    return np.arange(int(RATE * seconds)) / RATE


def env(n, attack=0.005, decay=0.2, sustain=0.0, release=0.05, hold=0.0):
    """A simple ADSR envelope of n samples (times in seconds)."""
    a, d, h, r = (int(RATE * x) for x in (attack, decay, hold, release))
    out = np.zeros(n)
    i = 0
    seg = min(a, n - i)
    out[i:i + seg] = np.linspace(0, 1, seg, endpoint=False)
    i += seg
    seg = min(d, n - i)
    out[i:i + seg] = np.linspace(1, sustain, seg, endpoint=False) if seg > 0 else []
    i += seg
    seg = min(h, n - i)
    out[i:i + seg] = sustain
    i += seg
    rest = n - i
    if rest > 0:
        out[i:] = np.linspace(sustain, 0, rest) if sustain > 0 else 0
    if r > 0 and n > r:
        out[-r:] *= np.linspace(1, 0, r)
    return out


def exp_decay(n, tau):
    return np.exp(-np.arange(n) / (RATE * tau))


def tone(freq, seconds, shape="sine", tau=0.3, attack=0.004):
    x = t(seconds)
    phase = 2 * np.pi * np.cumsum(np.broadcast_to(freq, x.shape)) / RATE
    if shape == "sine":
        w = np.sin(phase)
    elif shape == "tri":
        w = 2 / np.pi * np.arcsin(np.sin(phase))
    elif shape == "saw":
        w = 2 * ((phase / (2 * np.pi)) % 1.0) - 1
    else:
        raise ValueError(shape)
    e = exp_decay(len(x), tau)
    a = int(RATE * attack)
    if a:
        e[:a] *= np.linspace(0, 1, a)
    return w * e


def lowpass(x, cutoff):
    """One-pole low-pass; cutoff may be a scalar or a per-sample array."""
    c = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    alpha = 1 - np.exp(-2 * np.pi * c / RATE)
    y = np.zeros_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += alpha[i] * (x[i] - acc)
        y[i] = acc
    return y


def bandnoise(seconds, lo, hi):
    n = RNG.standard_normal(int(RATE * seconds))
    return lowpass(n, hi) - lowpass(n, lo)


def bell(freq, seconds, tau=0.35):
    """An inharmonic bell: a few partials, the high ones dying first."""
    parts = [(1.0, 1.0, tau), (2.0, 0.5, tau * 0.6), (2.76, 0.35, tau * 0.45), (5.4, 0.18, tau * 0.25)]
    return sum(amp * tone(freq * ratio, seconds, "sine", tau=tt, attack=0.002) for ratio, amp, tt in parts)


def place(total, *items):
    """Mix (offset_seconds, signal) items into one buffer `total` seconds long."""
    out = np.zeros(int(RATE * total))
    for offset, sig in items:
        i = int(RATE * offset)
        j = min(len(out), i + len(sig))
        out[i:j] += sig[: j - i]
    return out


def note(name):
    names = {"C": -9, "D": -7, "E": -5, "F": -4, "G": -2, "A": 0, "B": 2}
    step = names[name[0]] + (1 if "#" in name else 0)
    octave = int(name[-1])
    return 440.0 * 2 ** ((step + 12 * (octave - 4)) / 12)


def finish(x, peak_db=-1.0, fade=0.01):
    x = x - np.mean(x)
    f = int(RATE * fade)
    if 0 < f < len(x):
        x[-f:] *= np.linspace(1, 0, f)
    peak = np.max(np.abs(x)) or 1.0
    return x / peak * 10 ** (peak_db / 20)


# ── the sounds ────────────────────────────────────────────────────────────────────


def click():
    n = int(RATE * 0.05)
    noise = bandnoise(0.05, 1500, 6000) * exp_decay(n, 0.006)
    blip = tone(2200, 0.05, "sine", tau=0.01, attack=0.001)
    return finish(0.6 * noise + blip, -6)


def spin():
    d = 0.42
    x = t(d)
    sweep = np.linspace(500, 3200, len(x))
    whoosh = (lowpass(RNG.standard_normal(len(x)), sweep) - lowpass(RNG.standard_normal(len(x)), sweep * 0.35))
    whoosh *= env(len(x), attack=0.12, decay=0.3, release=0.05)
    thump = tone(np.linspace(140, 60, int(RATE * 0.12)), 0.12, "sine", tau=0.05)
    return finish(place(d, (0, whoosh), (0, 0.8 * thump)), -4)


def reel_stop(top=150, bottom=70):
    d = 0.16
    body = tone(np.linspace(top, bottom, int(RATE * d)), d, "sine", tau=0.045, attack=0.001)
    knock = bandnoise(0.03, 800, 4000) * exp_decay(int(RATE * 0.03), 0.004)
    return finish(place(d, (0, body), (0, 0.5 * knock)), -3)


def scatter(root="C6", fifth="G6"):
    d = 0.8
    ding = bell(note(root), d, tau=0.3) + 0.6 * bell(note(fifth), d, tau=0.22)
    sparkle = bandnoise(d, 5000, 12000) * exp_decay(int(RATE * d), 0.08) * 0.15
    return finish(place(d, (0, ding), (0.02, sparkle)), -3)


def arpeggio(notes, step, total, tau=0.35, shape="tri"):
    items = [(i * step, tone(note(n), total - i * step, shape, tau=tau)) for i, n in enumerate(notes)]
    return place(total, *items)


def big_win():
    d = 1.6
    run = arpeggio(["C5", "E5", "G5", "C6", "E6", "G6"], 0.07, d, tau=0.25)
    chord = sum(tone(note(n), 1.1, "tri", tau=0.5, attack=0.01) for n in ("C5", "E5", "G5", "C6"))
    shimmer = bandnoise(1.1, 4000, 11000) * exp_decay(int(RATE * 1.1), 0.25) * 0.12
    return finish(place(d, (0, run), (0.45, 0.5 * chord), (0.45, shimmer)), -1.5)


def brass(freq, seconds, tau=0.6):
    """A saw through a low-pass that opens and closes: a soft brass stab."""
    x = t(seconds)
    raw = tone(freq, seconds, "saw", tau=tau, attack=0.02) + 0.5 * tone(freq * 1.003, seconds, "saw", tau=tau, attack=0.02)
    cutoff = 600 + 2600 * exp_decay(len(x), 0.25)
    return lowpass(raw, cutoff)


def fs_start():
    d = 2.0
    stab1 = brass(note("G4"), 0.18, tau=0.12) + brass(note("D5"), 0.18, tau=0.12)
    stab2 = brass(note("G4"), 0.18, tau=0.12) + brass(note("D5"), 0.18, tau=0.12)
    chord = sum(brass(note(n), 1.6, tau=0.7) for n in ("C5", "E5", "G5", "C6"))
    bells = arpeggio(["C6", "E6", "G6", "C7"], 0.06, 1.2, tau=0.25, shape="sine") * 0.5
    swell = bandnoise(1.4, 3000, 10000) * env(int(RATE * 1.4), attack=0.4, decay=1.0, release=0.1) * 0.15
    return finish(place(d, (0, stab1), (0.2, stab2), (0.42, chord), (0.42, bells), (0.3, swell)), -1)


def retrigger():
    d = 0.8
    return finish(arpeggio(["E5", "G5", "C6", "E6"], 0.06, d, tau=0.22, shape="sine") + 0.5 * bell(note("C7"), d, tau=0.2), -2)


def fs_end():
    d = 2.2
    first = sum(tone(note(n), 0.7, "tri", tau=0.35, attack=0.01) for n in ("F4", "A4", "C5", "F5"))
    last = sum(tone(note(n), 1.6, "tri", tau=0.8, attack=0.02) for n in ("C4", "G4", "C5", "E5", "G5"))
    bells = bell(note("C6"), 1.6, tau=0.6) * 0.6
    return finish(place(d, (0, 0.8 * first), (0.45, last), (0.45, bells)), -1)


def spin_loop():
    """A soft whir with a fast ratchet, exactly one second, so it loops without a seam."""
    d = 1.0
    n = int(RATE * d)
    x = np.arange(n) / RATE
    noise = RNG.standard_normal(n)
    noise = np.concatenate([noise, noise])  # filter a doubled buffer and keep the second half: no start-up transient
    whir = (lowpass(noise, 1800) - lowpass(noise, 400))[n:]
    ratchet = 0.5 + 0.5 * np.sin(2 * np.pi * 16 * x)  # 16 clicks a second, a whole number per loop
    body = whir * (0.55 + 0.45 * ratchet ** 6)
    return finish(body, -9, fade=0.0)


def anticipation():
    """A tension bed for the teasing reels: a low pulse under a shimmer, one second, loopable."""
    d = 1.0
    n = int(RATE * d)
    x = np.arange(n) / RATE
    pulse = np.sin(2 * np.pi * 55 * x) * (0.5 + 0.5 * np.sin(2 * np.pi * 4 * x)) ** 3  # 4 throbs a second
    noise = RNG.standard_normal(n)
    noise = np.concatenate([noise, noise])
    shimmer = (lowpass(noise, 9000) - lowpass(noise, 3500))[n:] * (0.6 + 0.4 * np.sin(2 * np.pi * 8 * x))
    fifth = 0.25 * np.sin(2 * np.pi * 82.5 * x)  # a fifth above the pulse
    return finish(pulse + fifth + 0.35 * shimmer, -6, fade=0.0)


def skip():
    d = 0.24
    x = t(d)
    sweep = np.linspace(3000, 300, len(x))
    w = (lowpass(RNG.standard_normal(len(x)), sweep) - lowpass(RNG.standard_normal(len(x)), sweep * 0.3))
    return finish(w * env(len(x), attack=0.01, decay=0.2, release=0.03), -6)


# file (relative to raw-assets/audio{m}) → the sound. The folder is the bus; .N are variants.
SOUNDS = {
    "reels/spin.wav": spin,
    "reels/spin-loop.wav": spin_loop,
    "reels/reel-stop.1.wav": lambda: reel_stop(150, 70),
    "reels/reel-stop.2.wav": lambda: reel_stop(165, 78),
    "reels/reel-stop.3.wav": lambda: reel_stop(138, 64),
    "symbols/scatter.1.wav": lambda: scatter("C6", "G6"),
    "symbols/scatter.2.wav": lambda: scatter("E6", "B6"),
    "symbols/scatter.3.wav": lambda: scatter("G6", "D7"),
    "wins/big-win.wav": big_win,
    "wins/fs-start.wav": fs_start,
    "wins/retrigger.wav": retrigger,
    "wins/fs-end.wav": fs_end,
    "anticipation/anticipation.wav": anticipation,
    "ui/click.wav": click,
    "ui/skip.wav": skip,
}


def write_wav(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())


def main():
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    template = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "packages/create-artubeplate/template")
    out = os.path.join(template, "raw-assets", "audio{m}")
    for rel, make in SOUNDS.items():
        path = os.path.join(out, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        write_wav(path, make())
        print(f"{rel}: {os.path.getsize(path)} B")


if __name__ == "__main__":
    main()
