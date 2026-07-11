# multisect

Set-theoretic operations on arrays, with counted multiset semantics and
allocation-free merge paths for already-sorted inputs. Results have explicit
order, count, and provenance contracts.

```ts
import { intersection } from 'multisect'
const a = [{ id: 'first', k: 1 }, { id: 'second', k: 1 }, { id: 'only-a', k: 2 }]
const b = [{ id: 'x', k: 1 }, { id: 'y', k: 1 }, { id: 'only-b', k: 3 }]
const result = intersection(a, b, { multiset: true, by: x => x.k })
result.map(x => x.id) // ['first', 'second']
// lodash, es-toolkit/compat, and Ramda return only one key-1 value
```

## Why this exists

The common array helpers silently choose set semantics. Run `npm run bench`
to reproduce this receipt:

| implementation | `intersection([1,1,2], [1,1,3])` | counted intersection | sorted merge mode | documented winner order |
|---|---:|---:|---:|---:|
| lodash | `[1]` | no | no | no |
| es-toolkit/compat | `[1]` | no | no | no |
| Ramda | `[1]` | no | no | no |
| **multisect** | `[1,1]` with `{ multiset: true }` | yes | yes | yes |

The main `es-toolkit` entry point behaves differently from its compatibility
entry point: it returns `[1,1]` for that example, but it is filtering the left
array, not counting both sides. For `[1,1,1]` intersected with `[1]`, it returns
all three copies. No incumbent above provides `min(countA, countB)` intersection
or an asserted-sorted, no-Map/Set path.

## Contracts

Equality is **SameValueZero everywhere**: `NaN` matches `NaN`, and `+0`
matches `-0`.

Set mode is the default (`multiset: false`) and deduplicates results. In
multiset mode, counts participate in every operation.

Element order and provenance are fixed:

- `intersection` in set mode returns the first occurrence in `a` of each
  shared value. In multiset mode it returns the **first**
  `min(countA(x), countB(x))` occurrences of `x`, in `a` order.
- `difference` in set mode returns the first occurrences in `a` of values not
  in `b`. In multiset mode it returns `max(0, countA(x) - countB(x))` copies,
  keeping `a`'s **first** such occurrences.
- `symmetricDifference` returns the `a` survivors in `a` order, followed by
  the `b` survivors in `b` order.
- `union` in set mode is `unique(a.concat(b))`. In multiset mode it returns
  `max(countA(x), countB(x))` copies: all of `a`'s occurrences first, followed
  by the first required extra occurrences from `b`, in `b` order.
- With `by`, comparisons use the extracted key and results carry the original
  elements. The winning occurrence is the one selected by the rules above.
- `sorted: true` asserts that both inputs ascend under `<` on their values, or
  on keys from `by`. The merge paths produce results **identical** to the
  unsorted paths on sorted inputs. multisect never mutates, copies-and-sorts,
  or silently repairs an input. One consequence to know: mixing string keys
  with non-string keys forfeits the merge path — JavaScript `<` can form
  comparison cycles across its lexical and numeric modes (`'10' < '2' < 3 <
  '10'`), so such inputs are routed to a correct but quadratic reference
  path. Keep sorted keys single-typed for the fast merge.

Sparse-array holes are read as `undefined`, exactly like indexed access and
array iteration. Inputs may be readonly. A `by` function is expected to return
a stable key for an element during one call.

## Performance

Microseconds per call on Node 24.13.1, Apple Silicon; lower is better. These
are real results from `npm run bench`. The script checks like-for-like outputs
before timing, prints the full 32-row matrix, and skips the quadratic naive
implementation at 100k rather than waiting on a misleading run.

| operation | workload | **multisect** | lodash | es-toolkit/compat | naive `filter+includes` |
|---|---|---:|---:|---:|---:|
| intersection | SMIs, 10 | **0.026µs** | 0.151µs | 0.316µs | 0.167µs |
| symmetric difference | SMIs, 10 | 0.444µs | **0.241µs** | 0.569µs | 0.430µs |
| union | SMIs, 10 | 0.281µs | 0.169µs | 0.311µs | **0.167µs** |
| intersection | SMIs, 100 | **1.80µs** | 2.89µs | 3.03µs | 3.41µs |
| intersection | SMIs, 1k | **16.9µs** | 29.5µs | 28.4µs | 200µs |
| difference | SMIs, 1k | 19.5µs | 17.8µs | **16.9µs** | 206µs |
| symmetric difference | SMIs, 1k | **50.4µs** | 52.5µs | 64.1µs | 460µs |
| union | SMIs, 1k | **27.4µs** | 34.3µs | 29.4µs | 256µs |
| intersection | SMIs, 100k | 6,386µs | **6,378µs** | 8,828µs | — |
| difference | SMIs, 100k | 7,230µs | **3,871µs** | 6,624µs | — |
| symmetric difference | SMIs, 100k | 12,834µs | **9,149µs** | 18,394µs | — |
| intersection | strings, 1k | **21.0µs** | 84.3µs | 41.2µs | 4,756µs |
| intersection | objects + `by`, 1k | **24.4µs** | 49.2µs | 39.3µs | 600µs |
| intersection | duplicate-heavy, 1k | 13.2µs | 27.5µs | **12.1µs** | 29.2µs |
| symmetric difference | duplicate-heavy, 1k | 23.7µs | 51.8µs | **13.5µs** | 60.0µs |
| intersection | pre-sorted SMIs, 100k | **553µs** | 8,330µs | 9,622µs | — |
| difference | pre-sorted SMIs, 100k | **580µs** | 4,925µs | 6,276µs | — |
| symmetric difference | pre-sorted SMIs, 100k | **1,095µs** | 11,851µs | 15,727µs | — |
| union | pre-sorted SMIs, 100k | **1,146µs** | 8,230µs | 9,414µs | — |

The losses are shown, and they have reasons. The generic difference path
loses (roughly ties es-toolkit at 1k, loses ~1.9× to lodash at 100k)
because it computes survivor counts before emitting so it can keep the
first occurrences the contract promises; symmetric difference inherits two
such passes. Duplicate-heavy symmetric difference loses to es-toolkit's
narrower set-only behavior for the same reason. The 10-element union and
symmetric-difference rows lose because those operations gate their nested
tiny path on `(m+n)² ≤ 160` — the honest cost of never letting an
asymmetric `(160, 1)` input pay a 12× quadratic surprise (an earlier
`m·n` gate did exactly that; see DESIGN.md §3). Sorted inputs avoid the
hash tables entirely and run roughly 7–15× faster than the generic
incumbents in this run.

For tiny inputs, nested scans avoid a Map/Set allocation. The unique-disjoint
worst-case crossover was between 144 and 196 pair comparisons on this runtime,
so the baked cutoff is 160. The exact receipt and reasoning are in
[DESIGN.md](./DESIGN.md).

## API

```ts
type Opts<T> = {
    multiset?: boolean
    sorted?: boolean
    by?: (x: T) => unknown
}

intersection(a, b, opts?)
difference(a, b, opts?)
symmetricDifference(a, b, opts?)
union(a, b, opts?)
isSubset(a, b, opts?)
isSuperset(a, b, opts?)
contentsEqual(a, b, opts?)
unique(a, by?)
```

`intersection` and `difference` return elements from `a`; their TypeScript
results preserve `A[]`. `union` and `symmetricDifference` may return elements
from either input and are typed `(A | B)[]`.

## Verification

`npm test` exhausts every array pair of length 0–4 over a small SameValueZero
pool, then cross-checks thousands of seeded arrays against deliberately simple
quadratic oracles. The suite includes identity objects, `by` collisions,
NaN/signed zero, holes, all-duplicate arrays, readonly/type assertions,
subsequence invariants, and sorted-vs-unsorted differential properties. Every
PR runs tests and the TypeScript build on Node 22 and 24.

## License

MIT © Xyra Sinclair
