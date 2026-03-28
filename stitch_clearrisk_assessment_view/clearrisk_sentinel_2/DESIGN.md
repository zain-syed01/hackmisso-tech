# Design System Strategy: The Architectural Sentinel

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Architectural Sentinel."** 

In the high-stakes world of cyber risk, users don't just need data; they need a sense of structural integrity and absolute clarity. We are moving away from the "generic SaaS dashboard" look. Instead, we are building a digital environment that feels like a high-end architectural firm—stable, premium, and meticulously organized. 

This design system breaks the "template" look through **intentional asymmetry** and **tonal depth**. We replace heavy-handed lines with breathing room and light-play. By utilizing high-contrast typography scales and overlapping surfaces, we create an editorial experience where the most critical risk data is staged as the hero, rather than just another row in a table.

---

## 2. Colors
Our palette is rooted in a professional "Trust Blue," supported by a sophisticated range of slates and whites that provide a sense of security and hygiene.

### The Palette
- **Primary (Trust Blue):** `#0062a1` — Used for primary actions and brand presence.
- **Surface Tiers:** 
  - `surface`: `#f8f9fb` (The base canvas)
  - `surface_container_low`: `#f2f4f6` (Secondary sections)
  - `surface_container_lowest`: `#ffffff` (Primary content cards)
- **Status Accents:** 
  - `error`: `#ba1a1a` (Critical Risk)
  - `secondary_container`: `#b7dbfe` (Informational/Low Risk)

### Design Directives
- **The "No-Line" Rule:** Explicitly prohibit the use of 1px solid borders for sectioning. Boundaries must be defined solely through background color shifts. For example, a questionnaire section (`surface_container_low`) should sit directly on the main `surface` without a stroke.
- **Surface Hierarchy & Nesting:** Treat the UI as a series of physical layers. Use `surface_container_lowest` (#ffffff) for the most interactive elements (like input cards) to make them "pop" against a `surface_container_low` (#f2f4f6) background.
- **The "Glass & Gradient" Rule:** To provide visual "soul," use subtle linear gradients for main CTAs, transitioning from `primary` (#0062a1) to `primary_container` (#339af0). For floating headers, use **Glassmorphism**: a semi-transparent `surface` color with a 12px backdrop-blur.

---

## 3. Typography
We utilize a dual-font system to balance authoritative weight with technical legibility.

- **Headlines (Manrope):** This font carries our "Architectural" weight. Use `display-lg` (3.5rem) for high-level risk scores to create an editorial impact.
- **Body & Technical Data (Inter):** Inter is our workhorse. Its high x-height ensures that even complex security questions remain accessible.
- **Hierarchy as Authority:** Use extreme scale contrast. A `headline-lg` title should be paired with a `label-md` uppercase sub-header to create an intentional, curated look that guides the eye.

---

## 4. Elevation & Depth
Depth in this design system is achieved through **Tonal Layering** rather than traditional structural lines.

- **The Layering Principle:** Place a `surface_container_lowest` card on a `surface_container_low` section. This creates a soft, natural lift that mimics fine paper stacked on a desk.
- **Ambient Shadows:** When a "floating" element is required (e.g., a critical modal or a hovering "Save" bar), use extra-diffused shadows. 
  - *Spec:* `box-shadow: 0 20px 40px rgba(25, 28, 30, 0.06);` 
  - The shadow color must be a tinted version of `on_surface` (#191c1e) at a very low opacity (4-8%).
- **The "Ghost Border" Fallback:** If a border is required for accessibility in input fields, use a "Ghost Border": the `outline_variant` token (#bfc7d3) at **15% opacity**. Never use 100% opaque, high-contrast borders.

---

## 5. Components

### Buttons
- **Primary:** Gradient fill (`primary` to `primary_container`), `md` (0.375rem) corner radius. No border.
- **Tertiary:** No background. Use `primary` text with an icon. Ensure padding follows the `spacing-3` (1rem) rule for a generous touch target.

### Cards & Lists
- **Forbid dividers.** To separate assessment questions, use `spacing-6` (2rem) of vertical white space or a subtle background shift between `surface` and `surface_container_low`.
- **Content Staging:** Use `surface_container_lowest` (#ffffff) for the card body to ensure maximum readability against the light gray background.

### Input Fields (Selects & Radios)
- **Text Inputs:** Use the "Ghost Border" (15% opacity `outline_variant`). On focus, transition the border to `primary` at 100% and add a subtle `primary_fixed` glow.
- **Radio Buttons:** When selected, use the `primary` color for the outer ring and a `surface_container_lowest` dot. The unselected state should be a subtle `outline_variant` circle.

### Progress Indicator
- Eschew the thin, default loading bar. Use a substantial, 8px tall track with a gradient fill. Place it at the very top of the container to act as a "horizon line" for the assessment experience.

---

## 6. Do's and Don'ts

### Do
- **Do** use generous white space. If a layout feels "crowded," increase the spacing using the `spacing-8` (2.75rem) or `spacing-10` (3.5rem) tokens.
- **Do** use `surface_container` tiers to group related security questions. 
- **Do** use Glassmorphism for "sticky" navigation bars to keep the interface feeling light and integrated.

### Don't
- **Don't** use 1px solid dividers (e.g., `<hr>` tags). They create "visual noise" that breaks the premium feel.
- **Don't** use pure black (#000000) for text. Always use `on_surface` (#191c1e) to maintain a soft, professional contrast.
- **Don't** use "Standard Blue" (#0000FF). Only use the specified "Trust Blue" (`primary`) for brand-consistent accents.
- **Don't** use sharp 90-degree corners. Always apply at least the `sm` (0.125rem) or `md` (0.375rem) roundedness to soften the "brutalism" into "architectural."