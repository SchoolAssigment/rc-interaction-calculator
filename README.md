# RC Column Interaction Calculator

This is a local calculator for the lecture example on rectangular reinforced-concrete column interaction curves.

## What it calculates

- Design concrete strength: `fcd = eta_cc * k_tc * fck / gamma_c`
- Design steel strength: `fyd = fyk / gamma_s`
- Steel yield strain: `epsilon_yd = fyd / Es`
- Rectangular concrete block: `Cc = fcd * b * a`, where `a = lambda * x`
- Steel stress from linear strain compatibility, capped at `+/- fyd`
- Axial resistance `NRd` and centroid moment `MRd`
- Independent rebar layers, so each layer can have a different depth and bar count
- Design action cases (`NEd`, `MEd`) plotted on the interaction curve

Compression is positive and tension is negative. Enter `NEd` as positive for compression. The chart plots `abs(MEd)` for the uniaxial interaction check. The moment is calculated about the gross-section centroid, matching the lecture screenshots.

## Run

From this folder:

```bash
python3 -m http.server 8000
```

Open:

```text
http://localhost:8000
```

If port `8000` is already busy, use another port such as:

```bash
python3 -m http.server 8001
```

You can also run the Python check:

```bash
python3 interaction_calculator.py
```

The default inputs reproduce the example section: `b = 300 mm`, `h = 500 mm`, `20 mm` bars, and three rebar layers at `z = 50, 250, 450 mm` with `2` bars each.

Use **Add Layer** in the Geometry panel to create layer-by-layer reinforcement, for example `z = 50 mm` with `3` bars and `z = 250 mm` with `2` bars.
