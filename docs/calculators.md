# Probability and Finance

Two calculator tabs. Fields accept numbers and simple expressions (`1/6`, `sqrt(2)/2`). A field that cannot be used gets a message that says how to fix it, and the chart is hidden until it can be drawn.

## Probability

| Mode                | What it does                                                                                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Counting**        | Permutations `n!/(n-r)!` or `n^r` with repeats, combinations `C(n, r)` or `C(n+r-1, r)` with repeats. `n` and `r` are whole numbers up to 1000. Results are exact; past fifteen digits the tab also shows scientific form and the full value. |
| **Two events**      | Give P(A), P(B), and how they relate (independent, cannot both happen, a known P(A and B), or a known P(A given B)). Shows P(A or B), both conditional probabilities, whether A and B are independent, and the four regions as bars.          |
| **Bayes' theorem**  | Prior P(H), sensitivity P(E given H), and false positive rate P(E given not H) give P(H given E), P(H given not E), and P(E), with the same numbers as counts out of 10,000 cases.                                                            |
| **Repeated trials** | Binomial probabilities: exactly, at most, at least, or between `k` successes in `n` trials (up to 5000), with the chosen region shaded. "At least" is computed from the opposite tail, so small tails keep their precision.                   |
| **Random variable** | One `value, probability` pair per line. The probabilities must add to 1 (within 1e-9). Gives the expected value, variance, and standard deviation, and marks the mean on a bar chart. Lines with the same value are added together.           |

## Finance

Rates are annual percentages. Amounts have no currency symbol.

| Mode                         | What it does                                                                                                                                                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Compound interest**        | A starting amount plus regular contributions. Interest compounds annually through daily, or continuously; contributions can be made at a different frequency, at the start or end of each period. Optional inflation shows the final balance in today's money. |
| **Savings goal**             | The contribution per payment that grows a starting amount to a goal. It is zero when the starting amount alone gets there.                                                                                                                                     |
| **Loan payments**            | Payment, total interest, and payoff time for a loan paid from yearly to weekly. Interest each period is the annual rate divided by payments per year. An extra payment each period shows the interest and time saved, and the table lists each year.           |
| **Present and future value** | Solve `FV = PV × (1 + r/n)^(n·t)` for the future value, present value, rate, or number of years.                                                                                                                                                               |
| **NPV and IRR**              | Cash flows one per period, starting at period 0. Gives NPV at a discount rate, the IRR, simple payback, the profitability index, and a chart of NPV against the discount rate. Several sign changes can give several IRRs; all are listed.                     |

The IRR search covers -99% to 1000% per period. Payback is the point where the running total first reaches zero, interpolated within the period.

These are teaching calculators. They ignore fees, taxes, and day-count conventions, so they will not match a lender's schedule to the cent in every case.
