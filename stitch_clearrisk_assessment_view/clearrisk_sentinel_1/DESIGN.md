# Design System Strategy: The Sentinel Narrative

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Digital Architect."** 

In the high-stakes world of Cyber Risk, "Modern and Trustworthy" should not mean "Generic Corporate Blue." Instead, we treat the UI as a high-end editorial dashboard—think of a bespoke architectural blueprint where precision meets clarity. We break the "SaaS Template" look by utilizing **intentional asymmetry** and **tonal depth**. Rather than boxing content into rigid grids, we use expansive white space and layered surfaces to guide the user’s eye toward critical vulnerabilities and prioritized actions. The goal is to make a non-technical user feel like they have the refined oversight of a Chief Information Security Officer.

---

## 2. Colors: Tonal Authority
We move beyond flat hex codes to a system of functional layers.

*   **Primary (#0058be):** Used exclusively for "The Path Forward." It is the beacon of action. 
*   **Secondary (#495e8a):** Reserved for supportive information and utility actions.
*   **Tertiary (#924700):** Our "Warning" tone. It is used sparingly to draw focus to risk without inducing panic.

### The "No-Line" Rule
**Explicit Instruction:** Do not use 1px solid borders to section off content. Traditional borders create visual noise that distracts from data. Define boundaries through background shifts only. 
*   *Example:* A `surface-container-low` (#f2f3ff) section sitting on a `background` (#faf8ff) creates a sophisticated, "borderless" containment.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers—stacked sheets of frosted glass.
*   **Base:** `surface` (#faf8ff)
*   **Level 1 (Sections):** `surface-container-low` (#f2f3ff)
*   **Level 2 (Cards):** `surface-container-lowest` (#ffffff) for maximum "lift" and clarity.
*   **Level 3 (Modals/Overlays):** `surface-bright` with Glassmorphism.

### The "Glass & Gradient" Rule
To elevate the experience, apply a subtle linear gradient to main CTAs (from `primary` to `primary_container`). For floating navigation or headers, use **Glassmorphism**: `surface` color at 80% opacity with a `20px` backdrop-blur. This ensures the "vibrant blue" feels integrated and premium, not just "pasted on."

---

## 3. Typography: Editorial Precision
We use a dual-font approach to balance authority with readability.

*   **Display & Headlines (Manrope):** This is our "Editorial" voice. Use `display-lg` (3.5rem) for high-level risk scores to give them an authoritative weight. Headlines should use tight letter-spacing (-0.02em) to feel "locked-in" and professional.
*   **Body & Labels (Inter):** Our "Technical" voice. Inter provides the legibility needed for complex risk descriptions. 
*   **Hierarchy as Brand:** Use `label-sm` (0.6875rem) in All Caps with 0.05em tracking for "Difficulty Badges" to create a metadata style common in premium technical journals.

---

## 4. Elevation & Depth: Tonal Layering
Traditional shadows are often a "crutch" for poor spacing. In this system, we prioritize **Tonal Layering**.

*   **The Layering Principle:** Depth is achieved by stacking. Place a `surface-container-lowest` card on top of a `surface-container-low` background. The slight shift in brightness creates a soft, natural lift.
*   **Ambient Shadows:** If a card must "float" (e.g., a prioritized action card), use a shadow tinted with the `on-surface` color: `box-shadow: 0 12px 32px -4px rgba(19, 27, 46, 0.04);`. This mimics natural light.
*   **The "Ghost Border" Fallback:** If accessibility requires a stroke, use the `outline-variant` token at **15% opacity**. A 100% opaque border is strictly forbidden.
*   **Glassmorphism:** Use for "Fixed" elements like sidebars or top-tier navigation to allow the "Deep Slate" and "Crisp White" colors to bleed through, softening the layout.

---

## 5. Components: The Sentinel Toolkit

### Progress Bars (Risk Gauges)
*   **Style:** Use a thick (12px) track with `surface-container-highest` as the base. 
*   **The "Glow" State:** The progress fill should use a subtle inner glow (drop-shadow) of its own color to represent "Active Monitoring."

### Prioritized Action Cards
*   **Structure:** No dividers. Use `Spacing-4` (1.4rem) to separate the title from the description.
*   **Difficulty Badges:** Use `surface-variant` containers with `on-surface-variant` text. High-contrast "Pill" shapes with `rounded-full`.

### Input Fields & Radio Options
*   **Inputs:** `surface-container-low` background, no border. On focus, transition to a `Ghost Border` using the `primary` color at 40% opacity.
*   **Radios:** Large, touch-friendly tiles rather than small circles. Selected state should use `primary_container` with an `on_primary_container` checkmark.

### Data Visualizations (Risk Scores)
*   **The Hero Metric:** Place the risk score in `display-sm` (Manrope) inside a large `surface-container-lowest` circle. 
*   **Charts:** Use `primary` for "Safe" data and `tertiary` for "Risk" data. Avoid "Stoplight" Red/Green; use our sophisticated palette to maintain the "Professional B2B" tone.

---

## 6. Do’s and Don’ts

### Do
*   **DO** use white space as a functional element. If in doubt, increase spacing by one tier on the scale (e.g., from `Spacing-6` to `Spacing-8`).
*   **DO** use `surface-container` tiers to group related items instead of lines.
*   **DO** ensure all icons (Lucide style) maintain a consistent `1.5px` or `2px` stroke weight.

### Don't
*   **DON'T** use pure black (#000000) for text. Use `on-surface` (#131b2e) to maintain the slate-gray sophistication.
*   **DON'T** use default 1px borders. If you feel you need a line, you likely need more white space.
*   **DON'T** use standard "Drop Shadows." Use Tonal Layering or the ultra-diffused Ambient Shadow spec.
*   **DON'T** crowd the screen. Cyber risk is stressful; the UI should be a calm, organized sanctuary of information.