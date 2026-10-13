# Dashboards

Dashboards display real-time engine data with customizable gauges and indicators.

## Overview

LibreTune dashboards are fully customizable layouts of gauges, indicators, and graphs that show live data from your ECU.

## Default Dashboards

LibreTune ships five dashboards, four of them built from the standard gauge
canvas and one being a purpose-built live face:

### Startup — live calibration monitor
The dashboard LibreTune opens on, and the one to leave up while driving. It is
not a gauge canvas: it is an instrument built around measured-versus-commanded
data. See [The Startup monitor](#the-startup-monitor) below.

### Motorsport
Fixed engineering monitor: dense telemetry face for track work.

### Race
Track-session layout: session clock, lap/segment timeline, giant centre RPM,
speed/AFR/boost/fuel readouts.

### Tuning
Calibration layout: mixed gauge types, lambda history graph, correction factor
readouts, EGT and duty cycle indicators.

### Telemetry Live
Strip-chart logging view for long sessions.

## Opening a Dashboard

The Dashboard tab is always present when a project is loaded. If it's ever missing:

1. Go to **View → Dashboard** to reopen it, or
2. The Dashboard tab is automatically created when you open a project

> **Note**: The Dashboard tab is protected from accidental closing. The close button (×) is hidden, and middle-click will not close it.

## Switching Dashboards

1. Click the dashboard selector (dropdown in header)
2. Choose from available dashboards
3. The view updates immediately

## The Startup Monitor

The Startup dashboard is rendered by purpose-built code rather than by the gauge
canvas, because it makes promises a generic gauge cannot keep.

### What it shows

| Region | Contents |
|--------|----------|
| **Status strip** | Project, ECU signature, link state and port, stream rate, channels per frame, logger control (start/stop, duration, channel and sample counts) and unsaved-tune state. |
| **Engine rail** | Derived engine phase (off / cranking / idle / over-run / running / load, with limiter and launch flags winning over the derivation), engine speed with the ECU's rev limit marked when it publishes one, MAP and boost (derived from MAP − baro when the ECU has no boost channel), throttle, pedal, baro, intake air temperature, coolant, oil pressure, oil temperature, battery, trigger sync, and this session's extremes. |
| **Live trace** | A multi-channel oscilloscope. Every lane prints the range it is drawing, the current value and its unit, and the threshold zones that apply. |
| **Fuel rail** | Measured fuel ratio against the commanded target with a rich/lean error meter, then fuel trim, injector duty, pulse width, fuel pressure, VE, ethanol content, fuel level, ignition advance, dwell, knock, knock retard and EGT, followed by the ECU's own state flags. |
| **Analysis strip** | Detected events (grouped per rule, with counts, thresholds and ages), fuelling accuracy against the commanded ratio over load cells, and the operating-envelope map (rpm × MAP) for this session — cell tint = mean fuelling error (amber lean, blue rich), cell opacity = dwell, with the worst cell named underneath. |

### Scope controls

| Control | Effect |
|---------|--------|
| **Live / Review** | Switches the centre between the live multi-channel scope and a scrub-through of the recorded session (the logger keeps recording either way). Live-only controls are hidden in Review, because they would do nothing there. |
| **5 / 10 / 20 / 30 s** | Time window. Bounded by the realtime buffer (~300 samples). |
| **Pause / Resume** | Freezes the exact window on screen and reports how far behind live it is. The ECU keeps streaming. |
| **Channels** | Adds or removes lanes. The list contains the curated tuning channels plus every channel the loaded INI publishes. |
| **Hover / arrow keys** | Moves the measurement cursor: a vertical line with every channel's value at that instant and the time offset. `Shift` + arrow jumps ten samples, `Home`/`End` jump to the window edges, `Esc` clears. |
| **Space** (canvas focused) | Pause/resume. |

### What it refuses to do

- Show a channel the loaded INI does not publish. A Speeduino four-cylinder and a
  rusEFI V8 do not get the same face, and empty tiles are never drawn.
- Invent a limit. Threshold bands are documented engine-protection numbers
  (coolant, IAT, oil pressure, battery, EGT, injector duty, fuel trim, knock) and
  every one of them is **printed under its tile** as a number; manifold pressure,
  boost and ignition advance have no invented limits — a boost ceiling only
  appears when the ECU publishes a boost target.
- Treat a dead sensor as a reading. On channels where a raw zero is physically
  impossible (oil and fuel pressure, λ/AFR, battery, dwell) a zero shows "—",
  breaks the trace and raises a sensor-dropout event instead of being plotted.
  A temperature of 0 °C is a reading, not a fault.
- Raise an alarm on a stopped engine: limit rules only arm while the engine is
  running, so a parked car cannot produce oil-pressure or battery warnings. The
  events panel reports how many rules are actually *armed* for your definition
  rather than how many exist.
- Compare against a target unless the ECU publishes one, or claim "on target"
  while a large excursion sits in the session's worst case.
- Show a light-mode screen where the labels are unreadable: the component carries
  its own contrast-safe tokens for the light theme.

### Units

Every number on the Startup face — tiles, thresholds, scope ranges, cursor
values — follows your unit preferences (Units Preset plus the per-quantity
Temperature / Pressure / Speed / AFR-λ choices in **Settings → General**). The
scope is drawn in the same units the tiles show; if you work in AFR and PSI, the
scope reads in AFR and PSI too.

## Real-Time Data

When connected to an ECU:
- Gauges update automatically (10Hz default)
- Values are color-coded by status (normal/warning/danger)
- Follow mode highlights current operating conditions

## Gauge Types

LibreTune supports all 13 standard gauge styles:

| Type | Description |
|------|-------------|
| **Analog Gauge** | Classic circular dial with metallic bezel and gradient needle |
| **Digital Readout** | LCD-style numeric display with metallic frame |
| **Horizontal Bar Gauge** | Horizontal progress bar with rounded corners and gradient fill |
| **Vertical Bar Gauge** | Vertical progress bar with tick marks and 3D effects |
| **Sweep Gauge** | Curved arc indicator with glowing tip and warning zones |
| **Horizontal Line Gauge** | Horizontal line indicator with gradient track |
| **Vertical Dashed Bar** | Segmented vertical bar with per-segment zone coloring |
| **Line Graph** | Time-series history chart with gradient fill |
| **Histogram** | Distribution bar chart centered on current value |
| **Round Gauge** | Circular gauge with 270° arc and tick marks |
| **Round Dashed Gauge** | Circular gauge with segmented arc |
| **Fuel Meter** | Specialized fuel level gauge |
| **Tachometer** | RPM-specific gauge with redline zone |

## Gauge Zones

Gauges can display warning zones:
- 🟢 **Green**: Normal operating range
- 🟡 **Yellow/Orange**: Warning zone
- 🔴 **Red**: Danger zone

## Designer Mode

To customize dashboard layout:
1. Right-click the dashboard background
2. Select **Designer Mode**
3. Drag gauges to reposition
4. Resize by dragging edges
5. Right-click gauges for options
6. Click **Exit Designer** when done

## Context Menu Options

Right-click any gauge or the background for options:

| Option | Description |
|--------|-------------|
| **Reload Default Gauges** | Reset to default configuration |
| **LibreTune Gauges** | Add gauges from INI definition |
| **Reset Value** | Clear displayed value |
| **Background** | Change background color/image |
| **Antialiasing** | Toggle smooth rendering |
| **Designer Mode** | Enable/disable layout editing |
| **Gauge Demo** | Animate gauges with simulated data |

## Importing Dashboards

LibreTune can import TunerStudio dashboard layouts:
1. Go to **File → Import Dashboard**
2. Select a `.dash` file
3. The layout is converted and displayed

## Creating Custom Dashboards

1. Start from a template or blank dashboard
2. Enter Designer Mode
3. Right-click → **Add Gauge**
4. Select the data channel
5. Configure gauge properties
6. Save the dashboard

## Next Steps

- [Using Dashboards](./dashboards/using.md) - Detailed usage guide
- [Customizing Gauges](./dashboards/customizing.md) - Gauge configuration
- [Creating Dashboards](./dashboards/creating.md) - Build custom layouts
