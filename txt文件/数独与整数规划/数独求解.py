"""Sudoku as a binary integer program. Requires NumPy and SciPy >= 1.9."""
import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import lil_matrix


def model(puzzle, block=2):
    p = np.asarray(puzzle)
    n = block * block
    if (p.shape != (n, n) or not np.issubdtype(p.dtype, np.integer)
            or np.any((p < 0) | (p > n))):
        raise ValueError("Expected an integer grid with entries 0..n")
    index = np.arange(n ** 3).reshape(n, n, n)
    groups = []
    for r in range(n):
        for c in range(n):
            groups.append(index[r, c, :])
    for r in range(n):
        for k in range(n):
            groups.append(index[r, :, k])
    for c in range(n):
        for k in range(n):
            groups.append(index[:, c, k])
    for br in range(0, n, block):
        for bc in range(0, n, block):
            for k in range(n):
                groups.append(index[br:br+block,
                                    bc:bc+block, k].ravel())
    A = lil_matrix((4 * n * n, n ** 3))
    for i, ids in enumerate(groups):
        A[i, ids] = 1
    lo, hi = np.zeros(n ** 3), np.ones(n ** 3)
    for r, c in zip(*np.nonzero(p)):
        lo[index[r, c, p[r, c] - 1]] = 1
    return index, Bounds(lo, hi), LinearConstraint(A.tocsc(), 1, 1)


def solve(puzzle, block=2):
    index, bounds, rules = model(puzzle, block)
    n = block * block
    def run(constraints):
        return milp(c=np.zeros(n ** 3),
                    integrality=np.ones(n ** 3),
                    bounds=bounds, constraints=constraints)
    first = run([rules])
    if first.status == 2:
        return None, "infeasible"
    if first.status != 0:
        raise RuntimeError(first.message)
    bits = np.rint(first.x)
    assert np.max(np.abs(first.x - bits)) < 1e-6
    assert np.allclose(rules.A @ bits, 1)
    assert np.all(bits >= bounds.lb) and np.all(bits <= bounds.ub)
    grid = bits.reshape(n, n, n).argmax(axis=2) + 1
    cut = lil_matrix((1, n ** 3))
    cut[0, np.flatnonzero(bits)] = 1
    exclude = LinearConstraint(cut.tocsc(), -np.inf, n * n - 1)
    second = run([rules, exclude])
    if second.status == 2:
        return grid, "unique"
    if second.status == 0:
        return grid, "multiple"
    raise RuntimeError(second.message)


if __name__ == "__main__":
    puzzle = [[1, 0, 0, 4], [0, 4, 1, 0],
              [2, 0, 4, 0], [0, 3, 0, 1]]
    grid, kind = solve(puzzle)
    print(grid)
    print(kind)
