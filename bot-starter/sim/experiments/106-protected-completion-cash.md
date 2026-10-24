# Experiment 106: protected completion cash — rejected

Every variant includes `futureCountNoise=1`; protectedCashBelow thresholds
are 0 (baseline), 10, 20, and 40. The best mean-place gain is only 0.009,
below the 0.08 replay gate. Higher thresholds regress. Keep the switch off;
no live trial or production adoption. Confidence intervals cluster seeds
within matches, and fixed historical opponent behavior limits inference.

market replay over 340 live matches x 2 seed(s), #257-1741 (rival score adjustment 0; fixed bids, not causal)

| variant | win% | mean place | last% | mean score | letters | coins left |
|---|---:|---:|---:|---:|---:|---:|
| (actual live results) | 23.2 | 3.04 | 9.1 | 82.8 | | |
| uncertainty | 22.4 | 2.87 | 5.1 | 85.3 | 12.0 | 29.6 | <!-- 45 s -->
| protected-cash10 | 22.6 | 2.86 | 5.0 | 85.3 | 12.0 | 29.4 | <!-- 45 s -->
| protected-cash20 | 22.1 | 2.89 | 5.3 | 84.9 | 12.0 | 29.3 | <!-- 41 s -->
| protected-cash40 | 20.1 | 3.00 | 6.9 | 82.8 | 11.9 | 28.6 | <!-- 41 s -->

Paired mean-place change vs first variant (negative is better; SE clusters seeds by match):
protected-cash10: -0.009 +/- 0.016 (approx 95%, 340 matches)
protected-cash20: 0.015 +/- 0.029 (approx 95%, 340 matches)
protected-cash40: 0.132 +/- 0.055 (approx 95%, 340 matches)
