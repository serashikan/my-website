"""Reproduce every figure and numerical example in the article.
Requires NumPy and Matplotlib. Run in any directory; outputs live next to this file.
"""
from pathlib import Path
from decimal import Decimal, localcontext
import math
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "images"
OUT.mkdir(exist_ok=True)
FONT_FILE = "/usr/local/texlive/2026/texmf-dist/fonts/truetype/public/arphic-ttf/gbsn00lp.ttf"
font = FontProperties(fname=FONT_FILE)
plt.rcParams.update({"font.family": [font.get_name(), "DejaVu Sans"], "font.size": 10,
                     "mathtext.fontset": "dejavusans",
                     "axes.unicode_minus": False, "axes.spines.top": False,
                     "axes.spines.right": False, "figure.dpi": 140})
# Register the file as well as its family name, avoiding a system-font dependency.
from matplotlib import font_manager
font_manager.fontManager.addfont(FONT_FILE)
BROWN, PINK, BLUE = "#A9713C", "#D8678F", "#3E8198"


def orbit(r, x=0.2, steps=50):
    values = [x]
    for _ in range(steps):
        x = r*x*(1-x)
        values.append(x)
    return np.array(values)


def decimal_pair(steps=50, precision=90):
    with localcontext() as ctx:
        ctx.prec = precision
        x, y = Decimal("0.2"), Decimal("0.200000001")
        a, b, error = [x], [y], [abs(x-y)]
        for _ in range(steps):
            x, y = 4*x*(1-x), 4*y*(1-y)
            a.append(x); b.append(y); error.append(abs(x-y))
        return a, b, error


def exponent(r, burn=2000, count=20000):
    x = 0.219
    for _ in range(burn):
        x = r*x*(1-x)
    total = 0.0
    for _ in range(count):
        d = abs(r*(1-2*x))
        if d == 0:
            return -math.inf
        total += math.log(d)
        x = r*x*(1-x)
    return total/count


def save(fig, name):
    fig.tight_layout()
    fig.savefig(OUT/name, dpi=240, facecolor="white")
    plt.close(fig)


def main():
    fig, ax = plt.subplots(figsize=(7.1, 2.5))
    t = np.linspace(0, 10, 500)
    for x0, color in [(0.1, BROWN), (0.5, PINK), (1.5, BLUE)]:
        ax.plot(t, 1/(1+(1/x0-1)*np.exp(-t)), color=color,
                label=f"$x(0)={x0}$")
    ax.axhline(1, color="#aaa", ls="--", lw=0.8)
    ax.set(xlabel="时间 t", ylabel="归一化数量 x(t)", ylim=(0, 1.6))
    ax.legend(ncol=3, frameon=False)
    save(fig, "continuous.png")

    fig, axes = plt.subplots(2, 2, figsize=(7.6, 4.8), sharex=True, sharey=True)
    for ax, r in zip(axes.flat, [2.5, 3.2, 3.5, 3.9]):
        ax.plot(orbit(r, steps=45), ".-", color=BROWN, ms=3, lw=0.8)
        ax.set(title=f"r = {r}", ylim=(0, 1))
    for ax in axes[-1]:
        ax.set_xlabel("代数 n")
    for ax in axes[:, 0]:
        ax.set_ylabel(r"数量比例 $x_n$")
    save(fig, "iterations.png")

    # Same parameter grid and finite sampling protocol for the two panels.
    rs = np.linspace(2.8, 4.0, 2600)
    xs = np.full(rs.shape, 0.219)
    for _ in range(1800):
        xs = rs*xs*(1-xs)
    fig, axes = plt.subplots(2, 1, figsize=(7.6, 5.4), sharex=True,
                             gridspec_kw={"height_ratios": [2, 1]})
    sums = np.zeros_like(rs)
    with np.errstate(divide="ignore"):
        for _ in range(600):
            axes[0].plot(rs, xs, ",", color=BROWN, alpha=0.2, rasterized=True)
            sums += np.log(np.abs(rs*(1-2*xs)))
            xs = rs*xs*(1-xs)
    axes[0].set(ylabel=r"舍去过渡后的 $x_n$", ylim=(0, 1))
    axes[0].axvspan(3.8285, 3.841, color=PINK, alpha=0.22)
    axes[1].plot(rs, sums/600, color=PINK, lw=0.65)
    axes[1].axhline(0, color="#888", ls="--", lw=0.7)
    axes[1].set(xlabel="参数 r", ylabel="有限步指数估计", ylim=(-2, 1), xlim=(2.8, 4))
    save(fig, "bifurcation.png")

    a, b, errors = decimal_pair()
    fig, axes = plt.subplots(2, 1, figsize=(7.6, 4.8), sharex=True)
    axes[0].plot([float(v) for v in a], ".-", color=BROWN, ms=2.5, label="0.200000000")
    axes[0].plot([float(v) for v in b], ".--", color=PINK, ms=2.5, label="0.200000001")
    axes[0].set(ylabel=r"$x_n$", ylim=(0, 1))
    axes[0].legend(frameon=False, ncol=2, title="初值",
                   loc="lower center", bbox_to_anchor=(0.5, 1.01))
    axes[1].semilogy([float(v) for v in errors], color=BLUE)
    axes[1].set(xlabel="迭代次数 n", ylabel="两条轨道的绝对差", ylim=(1e-11, 1))
    from matplotlib.ticker import FuncFormatter
    axes[1].yaxis.set_major_formatter(FuncFormatter(
        lambda value, _: "$10^{"+str(int(round(math.log10(value))))+"}$"))
    save(fig, "sensitivity.png")

    # Checks based on independent analytic identities, not a stored screenshot.
    assert abs(orbit(2.5, steps=300)[-1]-0.6) < 1e-12
    r = 3.2
    roots = [(r+1+sign*math.sqrt((r-3)*(r+1)))/(2*r) for sign in [-1, 1]]
    last = orbit(r, steps=1000)[-2:]
    assert np.allclose(sorted(last), roots, atol=1e-12)
    assert np.allclose(orbit(4, 0.5, 3), [0.5, 1, 0, 0])
    for r, period in [(3.5, 4), (3.83, 3)]:
        a0 = orbit(r, steps=2200)
        assert np.max(np.abs(a0[-60:]-a0[-60-period:-period])) < 1e-11
    assert abs(exponent(2.5)-math.log(0.5)) < 1e-10
    assert abs(exponent(4)-math.log(2)) < 0.002
    aa, bb, ee = decimal_pair(precision=120)
    assert max(abs(float(x-y)) for x, y in zip(a, aa)) < 1e-35
    for r in [2.5, 3.2, 3.5, 3.83, 3.9, 4.0]:
        print(f"r={r}: lambda~{exponent(r):.6f}")
    first = next(i for i, value in enumerate(errors) if value > Decimal("0.1"))
    print("First separation greater than 0.1:", first)
    print("All analytic checks passed. Figures written to", OUT)


if __name__ == "__main__":
    main()
