#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// The recipe art's finish (RecipeArtView), over the mesh from recipeArt(id:dark:):
// 1. flow: the mesh is sampled through a seeded, domain-warped noise field, so its soft blobs turn into marbled swirls;
// 2. lines: faint contour lines of the same field, like the edge of poured paint (header size only);
// 3. grain: film grain, one value per device pixel, a touch of colour in it.
// Flow and lines live in the art's own coordinates (fractions of its height), so a list tile, which is the middle
// of the header art, shows the same shapes; grain lives in device pixels, so it has the same fineness in both.
// Everything is seeded by the recipe: the same recipe draws the same on every frame and device.

// lowbias32: an integer hash with no visible pattern, unlike sin()-based hashes.
static uint artHash(uint x) {
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

static float artUnit(uint x) { return float(artHash(x)) * (1.0 / 4294967296.0); }

static float2 artGradient(int2 cell, uint seed) {
    uint h = artHash(uint(cell.x) * 1597334677u ^ uint(cell.y) * 3812015801u ^ seed);
    float angle = float(h) * (6.2831853 / 4294967296.0);
    return float2(cos(angle), sin(angle));
}

// Gradient noise in about -0.7…0.7, smooth (quintic fade).
static float artNoise(float2 p, uint seed) {
    int2 i = int2(floor(p));
    float2 f = fract(p);
    float2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = dot(artGradient(i, seed), f);
    float b = dot(artGradient(i + int2(1, 0), seed), f - float2(1, 0));
    float c = dot(artGradient(i + int2(0, 1), seed), f - float2(0, 1));
    float d = dot(artGradient(i + int2(1, 1), seed), f - float2(1, 1));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

static float artFbm(float2 p, uint seed) {
    float sum = 0.0, amplitude = 0.5;
    for (int octave = 0; octave < 4; octave++) {
        sum += amplitude * artNoise(p, seed + uint(octave) * 0x9e3779b9u);
        p = float2x2(1.6, 1.2, -1.2, 1.6) * p;   // rotate and scale: no grid alignment between octaves
        amplitude *= 0.5;
    }
    return sum;
}

/// size: the art's full frame in points; scale: device pixels per point.
/// flow: warp in fractions of the height; lines: contour opacity; grain: grain strength in sRGB.
[[ stitchable ]] half4 recipeArt(
    float2 position, SwiftUI::Layer layer, float seedValue, float2 size, float scale,
    float flow, float lines, float grain)
{
    uint seed = artHash(uint(seedValue));
    float2 uv = position / size.y;

    // Domain warping (two levels): q bends the field, r bends it again through q.
    float2 q = float2(artFbm(uv * 1.1, seed), artFbm(uv * 1.1 + float2(5.2, 1.3), seed ^ 0x51u));
    float2 r = float2(artFbm(uv * 1.1 + 3.0 * q + float2(1.7, 9.2), seed ^ 0xa3u),
                      artFbm(uv * 1.1 + 3.0 * q + float2(8.3, 2.8), seed ^ 0xc7u));
    float2 sampleAt = clamp(position + r * flow * size.y, float2(0.5), size - 0.5);
    half4 color = layer.sample(sampleAt);

    // Contour lines of the warped field: thin, soft, lighter on the dark parts and darker on the light parts.
    float field = (artNoise(uv * 1.1 + 2.6 * r, seed ^ 0xe1u) + 0.6 * r.x) * 6.0;   // one octave: smooth, marbled contours
    float distance = abs(fract(field) - 0.5) / max(fwidth(field), 1e-4);
    // Small art (list tiles) would pack the lines into a hatch: they fade out below 200 pt.
    float line = (1.0 - smoothstep(0.3, 1.8, distance)) * lines * smoothstep(120.0, 220.0, size.y);
    half luma = dot(color.rgb, half3(0.2126h, 0.7152h, 0.0722h));
    color.rgb = mix(color.rgb, luma > 0.55h ? color.rgb * 0.82h : min(color.rgb * 1.35h + 0.04h, 1.0h), half(line));

    // Grain: two uniform samples make a soft triangle in -1…1; strongest in the midtones, as on film.
    uint2 pixel = uint2(max(floor(position * scale), 0.0));
    uint key = pixel.x * 1597334677u ^ pixel.y * 3812015801u ^ seed;
    float noise = artUnit(key) + artUnit(key ^ 0x9e3779b9u) - 1.0;
    half3 tint = half3(artUnit(key ^ 0x1u), artUnit(key ^ 0x2u), artUnit(key ^ 0x3u)) - 0.5h;
    half weight = 0.35h + 2.6h * luma * (1.0h - luma);
    color.rgb += (half(noise) + tint * 0.5h) * half(grain) * weight;

    return half4(clamp(color.rgb, 0.0h, 1.0h) * color.a, color.a);
}

