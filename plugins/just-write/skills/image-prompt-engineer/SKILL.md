---
name: image-prompt-engineer
description: Generate AI-powered cover image and illustration prompts for WeChat articles. Use when designing cover art or article illustrations.
---

# Image Prompt Engineer

Create professional AI image generation prompts using a structured layered approach.

## Prompt Structure

```
[Subject] in [environment], [lighting setup], [camera/lens specs],
[style reference], [post-processing], [aspect ratio], [quality].
```

## Layers

### 1. Subject (required)
Primary focus: person, object, scene. Include details: expression, pose, texture, material.

### 2. Environment
Location type (studio/outdoor/urban). Background treatment (blur/context). Atmosphere (fog/mist/clear).

### 3. Lighting
Source (natural/studio), direction (side/front/back), quality (hard/soft/diffused), color temperature (warm/cool).

### 4. Camera & Lens
Perspective (eye-level/low/high angle), focal length (85mm portrait, 24mm wide), depth of field (shallow f/1.4, deep f/11).

### 5. Style
Genre (editorial/commercial/documentary), era (contemporary/vintage), reference photographers.

### 6. Post-processing
Color grading, contrast, film stock emulation, grain.

### 7. Technical Specs
Aspect ratio (2:3 portrait for covers), resolution (8k), negative prompt (text, watermark, busy background).

## Output Format

```
【Cover Image / Illustration】
Theme: [one-line description]
Style: [aesthetic direction]
Prompt: [full English prompt]
Negative: [things to avoid]
```
