# Card fonts

Drop `.ttf` or `.otf` files in this folder and VOLTA registers them
automatically under the family name **Volta**, which every card renderer uses.

Weight is read from the filename:

| Filename contains | Registered weight |
|---|---|
| `Light`      | 300 |
| (nothing)    | 400 |
| `Medium`     | 500 |
| `SemiBold`   | 600 |
| `Bold`       | 700 |
| `ExtraBold`  | 800 |
| `Black` / `Heavy` | 900 |

`Italic` or `Oblique` in the name registers the italic style.

Example set that covers every weight the cards ask for:

    Inter-Regular.ttf
    Inter-SemiBold.ttf
    Inter-Bold.ttf
    Inter-Black.ttf

Why this matters: most Linux containers ship with **no fonts at all**. Canvas
does not error on a missing font — it just draws nothing, so you get a
correctly-shaped card with invisible text. Bundling the font here makes card
output identical on your laptop and on the server.
