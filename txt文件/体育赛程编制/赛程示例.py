"""Six-team round robin with hard constraints and two conflicting wishes.
Requires NumPy and SciPy >= 1.9. All printed round numbers start at 1.
"""
from itertools import combinations
import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import lil_matrix


def circle(n):
    """Return optimal-round pairings; a dummy team creates odd-team byes."""
    size = n if n % 2 == 0 else n + 1
    q = size - 1
    rounds = []
    for t in range(q):
        games = [(q, t)] + [((t+d) % q, (t-d) % q)
                             for d in range(1, size // 2)]
        rounds.append([tuple(sorted(g)) for g in games if max(g) < n])
    return rounds


def solve():
    n, T = 6, 5
    pairs = list(combinations(range(n), 2))
    # A=0, B=1, ..., F=5. Each candidate is (team i, team j, round t).
    candidates = [(i, j, t) for i, j in pairs for t in range(T)]
    ids = {g: k for k, g in enumerate(candidates)}
    rows, lower, upper = [], [], []
    def add(columns, lb, ub):
        rows.append(columns); lower.append(lb); upper.append(ub)
    for i, j in pairs:
        add([ids[i, j, t] for t in range(T)], 1, 1)
    for i in range(n):
        for t in range(T):
            add([k for k, (a, b, s) in enumerate(candidates)
                 if s == t and i in (a, b)], 0, 1)
    A = lil_matrix((len(rows), len(candidates)))
    for r, columns in enumerate(rows):
        A[r, columns] = 1
    lo, hi = np.zeros(len(candidates)), np.ones(len(candidates))
    hi[ids[0, 1, 0]] = 0  # A-B cannot play in round 1.
    hi[ids[2, 3, 4]] = 0  # C-D cannot play in round 5.
    lo[ids[0, 5, 2]] = 1  # A-F must play in round 3.
    # Both A-B and A-C want the last round: each unfulfilled wish costs 1.
    cost = np.array([int((i, j) in [(0, 1), (0, 2)] and t != T-1)
                     for i, j, t in candidates], dtype=float)
    result = milp(cost, integrality=np.ones(len(candidates)),
                  bounds=Bounds(lo, hi),
                  constraints=LinearConstraint(A.tocsc(), lower, upper),
                  options={"mip_rel_gap": 0})
    if result.status != 0:
        raise RuntimeError(result.message)
    bits = np.rint(result.x)
    assert np.max(np.abs(bits-result.x)) < 1e-6
    assert np.all(bits >= lo) and np.all(bits <= hi)
    values = A @ bits
    assert np.all(values >= np.array(lower)-1e-6)
    assert np.all(values <= np.array(upper)+1e-6)
    selected = [g for g, x in zip(candidates, bits) if x == 1]
    schedule = [[(i, j) for i, j, s in selected if s == t]
                for t in range(T)]
    return schedule, int(round(result.fun))


if __name__ == "__main__":
    schedule, penalty = solve()
    for t, games in enumerate(schedule, 1):
        print(t, "  ".join(f"{chr(65+i)}-{chr(65+j)}" for i, j in games))
    print("penalty =", penalty)
