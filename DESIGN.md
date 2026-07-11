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

JavaScript `<` is not a total order. `NaN`, distinct objects, and values such
as `3` and `'3'` can be SameValueZero-distinct while neither is less than the
other. Adjacent ambiguous keys trigger an allocation-free nested fallback
before the merge starts. Cross-array ambiguity is subtler: an input like
`[1, '2', 'a']` is validly ascending pairwise, yet `1` vs `'a'` is
incomparable — so every merge (`intersection`, the `difference` core that
also serves `symmetricDifference` and `union`, and the subset walk) treats
an in-merge comparison that is neither SameValueZero-equal nor ordered as a
failure sentinel, discards any partial output, and falls back to the nested
reference path. Skipping instead would silently lose cancellations (this was
a real bug caught in adversarial review: sorted `difference([1,'2','a'],
['a'])` returned all three elements, and set-mode union emitted a
duplicate). This preserves the sorted-equals-unsorted promise without
allocating a hash table.

There is a third, deeper failure the sentinel cannot see: `<` contains
**cycles** across its two comparison modes. Strings compare lexically,
everything else numerically, and the orders can disagree — `'10' < '2'`
(lexical), `'2' < 3` (numeric), `3 < '10'` (numeric). Every pairwise
comparison is decisive, so neither the adjacency scan nor the in-merge
sentinel fires, yet transitivity is gone: SameValueZero-equal keys need not
be adjacent in a validly ascending array (breaking run-based dedup even
against an empty other side), and "a's head < b's head" no longer implies
anything about the rest of b (caught in adversarial review round 2). Each
mode is total and transitive on its own domain, so a cycle requires string
keys *and* non-string keys together. The sorted entry points therefore
scan once (the same pass as the adjacency check) for that mixture across
both key streams and route it to the nested path. Ordinary all-number,
all-string, number+bigint, and stable single-type `by` keys stay on the
linear merge path.

Sorted merge time is `O(m + n)` and result space is the only required
allocation. The ambiguity fallback is quadratic, intentionally, because the
asserted comparison relation did not provide a usable merge order.

## 5. Correctness argument

For an unsorted key `x`, each path computes one of four target counts:

| operation | target count |
|---|---:|
| intersection | `min(Ax, Bx)` |
| difference `a - b` | `max(0, Ax - Bx)` |
| symmetric difference | `abs(Ax - Bx)` |
| union | `max(Ax, Bx)` |

Walking the owner array from left to right and stopping after the target count
selects exactly its first required occurrences. Set deletion/addition is the
count-one specialization of the same argument.

On sorted inputs, equal keys form contiguous runs whenever `<` supplies the
asserted order — and pairwise-ascending does NOT by itself imply `<`
supplies an order (the cycle case above), which is exactly why the
type-mix gate exists. On the key domains that reach the merge, `<` is
total and transitive, runs are contiguous, and the merge compares the same
`Ax` and `Bx` run lengths, then applies the same target formula and owner
rule. If `<` exposes an equivalence that is not SameValueZero, or refuses
to order a cross-array pair, the nested path evaluates membership
directly. Therefore changing `sorted` cannot change a result on inputs
satisfying the contract.

Subset consumes at most the available count of each key; set subset only asks
for membership. Superset reverses the arguments. Contents equality is mutual
set containment or exact multiset count exhaustion.

## 6. Verification architecture

The test oracle deliberately does not share the optimized code. It counts and
searches with obvious nested loops, then selects occurrences directly from the
contract. The suite includes:

- all 14,641 pairs of arrays of length 0–4 over `[0, 1, NaN]`, in both modes;
- 3,000 seeded size-0–12 cases containing NaN, signed zero, primitives,
  duplicates, and objects by identity;
- 2,000 seeded `by` cases with colliding keys and 300 cases crossing the
  adaptive boundary;
- 2,000 sorted-vs-unsorted numeric cases and 500 sorted object-key cases;
- duplicate-free set/multiset equivalence, multiset containment, and
  result-is-subsequence properties;
- empty, all-duplicate, sparse, ambiguous-comparison, provenance, and readonly
  TypeScript batteries.

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
