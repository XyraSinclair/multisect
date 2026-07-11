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
  or silently repairs an input.

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
| intersection | SMIs, 10 | **0.030µs** | 0.171µs | 0.328µs | 0.187µs |
| intersection | SMIs, 100 | **1.96µs** | 3.36µs | 3.11µs | 3.47µs |
| intersection | SMIs, 1k | **17.9µs** | 34.9µs | 33.9µs | 266µs |
| difference | SMIs, 1k | 30.7µs | 20.4µs | **17.8µs** | 229µs |
| symmetric difference | SMIs, 1k | **46.9µs** | 53.7µs | 71.1µs | 507µs |
| union | SMIs, 1k | **29.1µs** | 40.0µs | 36.1µs | 295µs |
| intersection | SMIs, 100k | **6,566µs** | 6,979µs | 9,495µs | — |
| intersection | strings, 1k | **26.5µs** | 95.3µs | 41.8µs | 4,884µs |
| intersection | objects + `by`, 1k | **27.1µs** | 53.5µs | 41.7µs | 614µs |
| intersection | duplicate-heavy, 1k | **13.3µs** | 28.6µs | 13.6µs | 31.8µs |
| intersection | pre-sorted SMIs, 100k | **651µs** | 9,426µs | 10,327µs | — |
| difference | pre-sorted SMIs, 100k | **690µs** | 6,086µs | 9,967µs | — |
| symmetric difference | pre-sorted SMIs, 100k | **1,576µs** | 12,770µs | 21,949µs | — |
| union | pre-sorted SMIs, 100k | **1,613µs** | 9,257µs | 10,107µs | — |

The generic difference path loses to both incumbents at 1k and to lodash at
100k. It computes survivor counts before emitting so it can keep the first
occurrences required by the contract; lodash and es-toolkit do less work for
their narrower set-only behavior. Symmetric difference inherits two such
passes. This is an accepted cost. Sorted inputs avoid the hash tables and are
roughly 6–16× faster than the generic incumbents in this run.

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
