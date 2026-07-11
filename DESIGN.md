# multisect — design

multisect implements set and multiset operations without allowing algorithm
choice to leak into observable order, count, or element provenance. This file
records the semantics, the three execution paths, and the measurements behind
the only tuned constant.

## 1. Semantics before algorithms

Every operation compares keys with SameValueZero. With no `by`, the element is
its own key. With `by`, keys decide membership but outputs retain the original
occurrences. This makes provenance observable when several objects share a
key, so count arithmetic alone is not a sufficient contract.

The output rules reduce to two primitives:

1. A survivor count is computed for each key: minimum for intersection,
   positive subtraction for difference, absolute subtraction for symmetric
   difference, and maximum for union.
2. The required number of **first** occurrences is selected from the owning
   input. Symmetric difference concatenates the two ownership passes. Union
   owns all `a` occurrences and then takes the first missing copies from `b`.

Set mode is the same model with counts clamped to zero or one. Sparse holes are
ordinary `undefined` values because all paths read `array[i]` or iterate the
array; neither checks property presence.

## 2. Unsorted paths

The general set path uses `Set` membership. Where possible, the membership set
also records emitted keys: intersection deletes a key when it emits, and set
difference adds a newly emitted non-member to the exclusion set. This avoids a
second allocation on those operations.

The general multiset path uses `Map<key, count>`. Intersection consumes the
counts of `b` while walking `a`. Difference first subtracts `b` from counts of
`a`, then walks `a` to emit the first surviving copies. Symmetric difference
performs the two directional difference passes. Union is all of `a` followed
by the directional multiset difference `b - a`.

These paths are `O(m + n)` expected time and `O(u)` auxiliary space, where `u`
is the number of distinct keys. No runtime dependency participates.

## 3. Tiny arrays

Hash tables have a fixed construction and allocation cost. The tiny path uses
only nested SameValueZero scans and the result array. It is quadratic, but its
constant is low and there is no allocation cliff.

`npm run bench` measures a unique, disjoint intersection, the unfavorable case
for nested scans because every lookup runs to completion. Node 24.13.1 on Apple
Silicon produced:

| n × n | pair work | nested scan | Set path | faster |
|---:|---:|---:|---:|---|
| 8 × 8 | 64 | 0.031µs | 0.087µs | nested |
| 12 × 12 | 144 | 0.151µs | 0.168µs | nested |
| 14 × 14 | 196 | 0.202µs | 0.187µs | Set |
| 16 × 16 | 256 | 0.245µs | 0.197µs | Set |
| 20 × 20 | 400 | 0.372µs | 0.372µs | Set |
| 24 × 24 | 576 | 0.556µs | 0.346µs | Set |

The cutoff is therefore `a.length * b.length <= 160` for intersection,
difference, and the subset family, whose nested work is one-directional
`O(m·n)`. `union` and `symmetricDifference` scan both directions, so their
nested work is `O((m+n)²)` — an asymmetric `(160, 1)` pair passes the `m·n`
gate while doing ~160× the pair work of the map path (measured: 36µs nested
vs 2.9µs map for exactly that shape). They therefore gate on
`(m+n)² <= 160`. Duplicate-heavy inputs favor nested scans beyond these
boundaries, but choosing the conservative unique-disjoint crossover prevents
a quadratic surprise. Empty-input cases do not enter the pair-work shortcut,
avoiding the `0 × huge` trap. `unique` uses the analogous `length² <= 160`
test.

## 4. Sorted merge paths

`sorted: true` is an assertion, not a request to sort. Both arrays must ascend
under `<` on values or extracted keys. multisect neither validates the entire
ordering nor copies and sorts an input.

The common sorted path advances over equal-key runs with two pointers. It does
not allocate a Map or Set. Intersection emits from `a`; difference walks the
runs once. Symmetric difference performs `a - b` and then `b - a` into one
result so its output is not accidentally interleaved. Union first emits `a`
and then performs `b - a`. These directional passes are necessary: a textbook
sorted union would return global sort order, violating the required
`unique(a.concat(b))` provenance.

Ascending inputs are not enough, because JavaScript `<` is not a total
order. The merges additionally require a **merge order**: `<` must behave
as a strict total order, up to SameValueZero, on the keys actually present.
That is what makes equal keys contiguous runs and head comparisons decisive
about everything that follows. `<` can fail to provide it in two ways.

**Incomparability.** `NaN`, distinct plain objects, or `3` vs `'3'` can be
SameValueZero-distinct while neither is less than the other. Adjacent
incomparable keys are rejected by a linear scan before the merge starts.
Cross-array incomparability cannot be seen cheaply up front — `[1, '2',
'a']` is validly ascending pairwise, yet `1` vs `'a'` has no verdict — so
every merge treats an unordered head pair as a refutation, discards its
partial output, and falls back. Skipping the pair instead would silently
lose cancellations: sorted `difference([1,'2','a'], ['a'])` once returned
all three elements, and set-mode union emitted a duplicate (a real bug
caught in adversarial review).

**Cycles.** `<` compares two strings lexically and everything else
numerically, and the two orders can disagree: `'10' < '2'` (lexical),
`'2' < 3` and `3 < '10'` (numeric). Every pairwise verdict is decisive, so
no refutation can fire mid-merge — yet transitivity is gone, equal keys
need not be contiguous in a validly ascending array, and the merge would
skip runs (caught in review round 2). Worse, which order a key joins
follows from its ToPrimitive result, not its typeof: arrays stringify, so
with `x = [10]` the chain `x < [2] < 3 < x` cycles with no string key
anywhere (caught in the beautification pass — it evaded the original
typeof-based gate). Symbols are a last corner in the same wall: `<` throws
on them, and a singleton smuggles one past any adjacency check.

The up-front witness scan therefore classifies each key's comparison mode:
lexical (strings), numeric (numbers, bigints, booleans, `null`,
`undefined`), or opaque (objects, functions, symbols). Opaque keys refuse
the merge outright — no cheap certificate covers them. A lexical + numeric
mixture across the two key streams refuses as well, since a cycle needs
both orders at once. Primitive keys in a single mode cannot cycle: each
mode is total and transitive on its own domain, and its incomparable cases
(`NaN`, `undefined`, ties like `true` vs `1`) are caught by the adjacency
scan or the in-merge refutation. All-number, all-string, number+bigint,
and stable primitive `by` keys stay on the linear merge path.

Sorted merge time is `O(m + n)` and result space is the only required
allocation. The fallback is quadratic, intentionally, because the asserted
comparison relation did not provide a usable merge order.

## 5. Correctness argument

The spine is one table and one rule. For a key `x` with `Ax` occurrences in
`a` and `Bx` in `b`, each operation owes exactly one target count:

| operation | target count | owner |
|---|---:|---|
| intersection | `min(Ax, Bx)` | `a` |
| difference `a - b` | `max(0, Ax - Bx)` | `a` |
| symmetric difference | `abs(Ax - Bx)` | `a`, then `b` |
| union | `max(Ax, Bx)` | all of `a`, then `b` |

**Owner rule.** Walk the owner array left to right and stop after the target
count — that selects exactly the first required occurrences. Symmetric
difference concatenates its two ownership passes; union owns all of `a` and
takes only the missing copies from `b`. Set mode is the same argument with
counts clamped to one. Subset consumes at most the available count of each
key, superset reverses the arguments, and contents equality is mutual
containment or exact count exhaustion.

Every path must realize this table. The nested paths compute `Ax` and `Bx`
by direct scanning — they are the table transcribed, which is why they are
also the fallback. The map paths compute the same counts in one hash-table
pass. The sorted paths rest on a lemma:

**Lemma (merge safety).** The merge runs only when `<` is a strict total
order, up to SameValueZero, on the keys present. On such a domain, equal
keys form contiguous runs in an ascending array, so run lengths are the
same `Ax` and `Bx`, and the merge applies the same target formula and
owner rule.

The lemma's hypothesis is witnessed in two stages (§4): comparison modes
and adjacent pairs up front, cross-array pairs during the merge itself.
Pairwise-ascending alone does not imply the hypothesis — that is the cycle
counterexample — which is exactly the gap the mode classification closes.
Whenever either stage refutes the witness, the nested path answers by
direct membership, never consulting `<`. Therefore changing `sorted`
cannot change a result on inputs satisfying the contract.

## 6. Verification architecture

The test oracle deliberately does not share the optimized code. It counts and
searches with obvious nested loops, then selects occurrences directly from the
contract. The suite includes:

- all 14,641 pairs of arrays of length 0–4 over `[0, 1, NaN]`, in both modes;
- 3,000 seeded size-0–12 cases containing NaN, signed zero, primitives,
  duplicates, and objects by identity;
- 2,000 seeded `by` cases with colliding keys and 300 cases crossing the
  adaptive boundary;
- 2,000 sorted-vs-unsorted numeric cases, 500 sorted object-key cases, and
  2,000 mixed-type valid-ascending fuzz cases whose pool makes cross-array
  incomparability and comparison cycles common;
- duplicate-free set/multiset equivalence, multiset containment, and
  result-is-subsequence properties;
- empty, all-duplicate, sparse, provenance, and readonly TypeScript
  batteries, plus exact pins for every historical sorted-path wrong answer:
  cross-array incomparability, string/number cycles, array-key cycles, and
  symbol keys.

All pseudo-random tests use in-file Mulberry32 generators with literal seeds.
No verdict depends on `Math.random`.

## 7. Benchmark methodology and limits

`bench.mjs` builds the package, verifies incumbent result keys against
multisect, warms each function, and doubles iterations until a timing window
exceeds 35ms. It covers all four operations on 10/100/1k/100k SMIs plus
strings, objects with `by`, duplicate-heavy inputs, and pre-sorted inputs.
Lodash, es-toolkit/compat, and a naive `filter+includes` implementation are
dev-only comparators. The naive quadratic path is skipped at 100k.

Microbenchmarks move with V8 and hardware. The README numbers are receipts for
one specified runtime, not universal rankings. In that run, generic difference
loses on several large workloads because preserving first-survivor provenance
requires a count pass before emission. The sorted path is the payoff when the
caller already owns the ordering.
