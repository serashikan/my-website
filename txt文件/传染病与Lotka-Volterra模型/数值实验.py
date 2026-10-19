"""Reproduce the combined SIR/Lotka-Volterra article's figures and checks.
Requires NumPy, SciPy and Matplotlib. Figures and metrics are saved beside this file.
Set CJK_FONT to a Chinese TrueType font if TeX Live is not installed.
"""
from pathlib import Path
import json
import math
import os
import shutil
import subprocess
import numpy as np
from scipy.integrate import solve_ivp
from scipy.optimize import brentq
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.font_manager import FontProperties

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "images"
OUT.mkdir(exist_ok=True)
font_file = os.environ.get("CJK_FONT")
if not font_file:
    finder = shutil.which("kpsewhich")
    if not finder:
        raise RuntimeError("Install TeX Live or set CJK_FONT to a Chinese TTF file")
    font_file = subprocess.check_output([finder, "gbsn00lp.ttf"], text=True).strip()
font_manager.fontManager.addfont(font_file)
family = FontProperties(fname=font_file).get_name()
plt.rcParams.update({"font.family": [family, "DejaVu Sans"], "font.size": 10,
                     "mathtext.fontset": "dejavusans", "axes.unicode_minus": False,
                     "axes.spines.top": False, "axes.spines.right": False})
BROWN, PINK, BLUE = "#A9713C", "#D8678F", "#3E8198"
N, BETA, GAMMA = 10000, 0.3, 0.1
SIR0 = np.array([0.999, 0.001, 0.0])
A, B, C, D = 1.0, 0.1, 0.02, 0.5
LV0 = np.array([40.0, 9.0])
XSTAR, YSTAR = D/C, A/B


def sir_rhs(t, z, beta=BETA, gamma=GAMMA):
    s, i, r = z
    incidence, removal = beta*s*i, gamma*i
    return [-incidence, incidence-removal, removal]


def lv_rhs(t, z, K=None):
    x, y = z
    growth = A*x if K is None else A*x*(1-x/K)
    return [growth-B*x*y, C*x*y-D*y]


def integrate(rhs, initial, end, **kwargs):
    result = solve_ivp(rhs, (0, end), initial, method="DOP853",
                       rtol=1e-10, atol=1e-12, dense_output=True, **kwargs)
    if not result.success:
        raise RuntimeError(result.message)
    return result


def conserved(z):
    x, y = z
    u, v = x/XSTAR, y/YSTAR
    return D*(u-1-np.log(u)) + A*(v-1-np.log(v))


def save(fig, name):
    fig.tight_layout()
    fig.savefig(OUT/name, dpi=240, facecolor="white")
    plt.close(fig)


def main():
    def infection_peak(t, z):
        return BETA*z[0]-GAMMA
    def incidence_peak(t, z):
        return BETA*(z[0]-z[1])-GAMMA
    infection_peak.direction = incidence_peak.direction = -1
    sir = integrate(sir_rhs, SIR0, 220, events=[infection_peak, incidence_peak])
    ti = float(sir.t_events[0][0])
    tc = float(sir.t_events[1][0])
    s, i, r = sir.sol(ti)
    peak_analytic = SIR0[0]+SIR0[1]-1/3+math.log((1/3)/SIR0[0])/3
    assert abs(i-peak_analytic) < 1e-9
    assert tc < ti and abs(s-1/3) < 1e-10
    sfinal = brentq(lambda x: math.log(x/SIR0[0])+3*(1-x), 1e-8, 1/3)
    t = np.linspace(0, 220, 2201)
    z = sir.sol(t)
    assert np.max(np.abs(z.sum(axis=0)-1)) < 1e-10
    assert z.min() > -1e-10
    sir_invariant = z[0]+z[1]-np.log(z[0])/3
    assert np.ptp(sir_invariant) < 1e-9
    assert abs(z[0,-1]-sfinal) < 2e-6
    strict_sir = solve_ivp(sir_rhs, (0,220), SIR0, method="DOP853",
                          rtol=1e-12, atol=1e-14, t_eval=t)
    assert np.max(np.abs(z-strict_sir.y)) < 2e-8

    fig, axes = plt.subplots(2, 1, figsize=(7.6, 4.3), sharex=True)
    for values, label, color in zip(z, ["易感 S", "传染 I", "移出 R"], [BLUE,PINK,BROWN]):
        axes[0].plot(t, N*values, color=color, label=label)
    axes[0].set(ylabel="人数", ylim=(0,12000))
    axes[0].legend(frameon=False, ncol=3, loc="upper right")
    axes[1].plot(t, N*BETA*z[0]*z[1], color=PINK, label="新增感染速率")
    axes[1].plot(t, N*GAMMA*z[1], color=BROWN, label="移出速率")
    for ax in axes:
        ax.axvline(ti, color="#999", ls="--", lw=0.8)
    axes[1].set(xlabel="时间（天）", ylabel="人数 / 天", xlim=(0,160))
    axes[1].legend(frameon=False, loc="upper right")
    save(fig, "sir_stocks_flows.png")

    fig, ax = plt.subplots(figsize=(7.4, 2.8))
    for beta, color in [(0.3,PINK),(0.18,BROWN),(0.09,BLUE)]:
        trial=integrate(lambda t,z: sir_rhs(t,z,beta), SIR0, 220)
        ax.plot(t, N*trial.sol(t)[1], color=color,
                label=rf"$\beta={beta},\quad\mathcal{{R}}_0={beta/GAMMA:g}$")
    ax.set(xlabel="时间（天）", ylabel="有传染性人数 I", xlim=(0,220))
    ax.legend(frameon=False, fontsize=9, loc="upper right")
    save(fig, "sir_beta.png")

    lv = integrate(lv_rhs, LV0, 50)
    tlv = np.linspace(0,50,5001)
    classical = lv.sol(tlv)
    h = conserved(classical)
    assert classical.min()>0 and np.ptp(h)<1e-8
    assert np.max(np.abs(lv_rhs(0,[XSTAR,YSTAR]))) < 1e-12
    strict_lv = solve_ivp(lv_rhs,(0,50),LV0,method="DOP853",
                         rtol=1e-12,atol=1e-14,t_eval=tlv)
    assert np.max(np.abs(classical-strict_lv.y)) < 2e-6
    logistic = integrate(lambda t,z:lv_rhs(t,z,100),LV0,50)
    modified = logistic.sol(tlv)
    modified_eq = [XSTAR, YSTAR*(1-XSTAR/100)]
    assert np.max(np.abs(lv_rhs(0,modified_eq,100))) < 1e-12
    assert np.linalg.norm(modified[:,-1]-modified_eq)<0.08
    # Locate consecutive maxima without relying on the plotted sampling grid.
    def prey_peak(t,z): return A-B*z[1]
    def predator_peak(t,z): return C*z[0]-D
    prey_peak.direction=predator_peak.direction=-1
    lv_events=integrate(lv_rhs,LV0,25,events=[prey_peak,predator_peak])
    tx,ty=[float(events[0]) for events in lv_events.t_events]
    assert tx < ty

    fig,axes=plt.subplots(2,1,figsize=(7.6,4.8),sharex=True)
    for ax,values,title in zip(axes,[classical,modified],
              ["经典 Lotka-Volterra：持续振荡", "猎物增长加上资源限制：本例振荡衰减"]):
        ax.plot(tlv,values[0],color=BROWN,label="猎物 X")
        ax.plot(tlv,values[1],color=PINK,label="捕食者 Y")
        ax.set(title=title,ylabel="模型数量",ylim=(0,50))
        ax.legend(frameon=False,ncol=2,loc="upper right")
    axes[1].set(xlabel="时间（年）",xlim=(0,40))
    save(fig,"lv_timeseries.png")

    fig,axes=plt.subplots(1,2,figsize=(7.8,3.5))
    for initial in [(40,9),(35,12),(29,10.5)]:
        values=integrate(lv_rhs,initial,25).sol(np.linspace(0,25,1800))
        axes[0].plot(*values,lw=1,color=BROWN,alpha=0.8)
    xs,ys=np.meshgrid(np.linspace(8,48,9),np.linspace(3,18,8))
    dx,dy=A*xs-B*xs*ys,C*xs*ys-D*ys
    length=np.sqrt(dx*dx+dy*dy)
    axes[0].quiver(xs,ys,dx/length,dy/length,color="#bbb",scale=25,width=0.003)
    axes[0].axvline(XSTAR,color=PINK,ls="--",lw=0.7)
    axes[0].axhline(YSTAR,color=BLUE,ls="--",lw=0.7)
    axes[0].plot(XSTAR,YSTAR,"o",color=PINK,ms=4)
    axes[0].set(title="经典模型：不同初值，不同闭轨",xlim=(7,50),ylim=(2,19))
    axes[1].plot(*modified,color=BLUE,lw=1)
    axes[1].plot(*modified_eq,"o",color=PINK,ms=4)
    axes[1].set(title="资源受限模型：本例向平衡螺旋靠近")
    for ax in axes: ax.set(xlabel="猎物数量 X",ylabel="捕食者数量 Y")
    save(fig,"lv_phase.png")

    dt=0.05
    te=np.arange(0,40+dt/2,dt)
    euler=[LV0.copy()]
    for tk in te[:-1]:
        euler.append(euler[-1]+dt*np.asarray(lv_rhs(tk,euler[-1])))
    euler=np.asarray(euler).T
    assert euler.min()>0
    exact=lv.sol(te)
    drift=conserved(euler)-conserved(LV0)
    assert drift[-1]>0.01
    fig,axes=plt.subplots(1,2,figsize=(7.8,3.4))
    axes[0].plot(*euler,color=PINK,label="欧拉法，步长 0.05 年",lw=1)
    axes[0].plot(*exact,color=BROWN,label="高精度参考",lw=1.3)
    axes[0].set(xlabel="猎物 X",ylabel="捕食者 Y",ylim=(4,20))
    axes[0].legend(frameon=False,fontsize=8)
    axes[1].plot(te,drift,color=PINK,label="欧拉法")
    axes[1].plot(te,conserved(exact)-conserved(LV0),color=BROWN,label="参考解")
    axes[1].set(xlabel="时间（年）",ylabel=r"$H(t)-H(0)$")
    axes[1].legend(frameon=False,fontsize=8)
    save(fig,"numerical_drift.png")

    metrics={"sir_I_peak_day":ti,"sir_incidence_peak_day":tc,
             "sir_peak_I":N*i,"sir_final_S":N*sfinal,
             "sir_final_ever_infected":N*(1-sfinal),
             "lv_prey_first_peak":tx,"lv_predator_first_peak":ty,
             "lv_small_period":2*math.pi/math.sqrt(A*D),
             "sir_invariant_drift":float(np.ptp(sir_invariant)),
             "lv_invariant_drift":float(np.ptp(h)),
             "euler_H_drift":float(drift[-1])}
    (ROOT/"验证数据.json").write_text(json.dumps(metrics,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps(metrics,ensure_ascii=False,indent=2))
    print("All conservation, peak, equilibrium, positivity and convergence checks passed.")


if __name__=="__main__":
    main()
