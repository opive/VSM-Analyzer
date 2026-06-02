"""
VSM Calculation Engine — implements Toyota Production System metrics.

A "process" is one station in the value stream (e.g. Stamping, Welding, Assembly).
Each process has:
  - cycle_time:    seconds to complete one unit at this station
  - wait_time:     seconds this unit sits idle BEFORE this station (queue/transport)
  - workers:       number of operators at this station
  - defect_rate:   fraction of units scrapped/reworked (0.0–1.0)
  - value_added:   whether this step adds value the customer pays for
"""


def analyze_value_stream(processes: list[dict], takt_time: float, daily_demand: int) -> dict:
    """
    Core VSM analysis. Returns all metrics needed by the frontend and the AI prompt.

    Args:
        processes:    list of process dicts (see module docstring)
        takt_time:    seconds per unit customer demands (available_time / daily_demand)
        daily_demand: units customer wants per day

    Returns:
        dict with metrics, bottleneck info, waste quantification, kaizen opportunities
    """
    if not processes:
        return {}

    analyzed = []
    total_lead_time = 0.0
    total_va_time = 0.0
    total_nva_time = 0.0

    for i, p in enumerate(processes):
        ct = float(p.get("cycle_time", 0))
        wait = float(p.get("wait_time", 0))
        workers = int(p.get("workers", 1))
        defect_rate = float(p.get("defect_rate", 0))
        is_va = bool(p.get("value_added", True))

        # Effective cycle time accounts for defect rework (unit must be redone)
        effective_ct = ct / max(1 - defect_rate, 0.001)

        # Utilization: how busy is this station relative to takt demand
        utilization = (effective_ct / takt_time * 100) if takt_time > 0 else 0

        # Is this station overloaded? (cycle time > takt time = bottleneck candidate)
        overloaded = effective_ct > takt_time

        step = {
            "index": i,
            "name": p.get("name", f"Process {i + 1}"),
            "cycle_time": ct,
            "effective_cycle_time": round(effective_ct, 2),
            "wait_time": wait,
            "workers": workers,
            "defect_rate": defect_rate,
            "value_added": is_va,
            "utilization": round(utilization, 1),
            "overloaded": overloaded,
        }
        analyzed.append(step)

        # Lead time = all time the unit spends (waiting + processing)
        total_lead_time += wait + ct
        if is_va:
            total_va_time += ct
        else:
            total_nva_time += ct

    # Process efficiency: what fraction of total time actually adds value
    process_efficiency = (total_va_time / total_lead_time * 100) if total_lead_time > 0 else 0

    # Bottleneck = station with highest effective cycle time
    bottleneck = max(analyzed, key=lambda s: s["effective_cycle_time"])

    # Total NVA includes waiting time (pure waste) + non-VA process time
    total_wait = sum(p.get("wait_time", 0) for p in processes)

    # Kaizen opportunities: heuristics based on TPS principles
    kaizen_opportunities = _identify_kaizen_opportunities(analyzed, takt_time, bottleneck)

    # Waste breakdown for dashboard
    waste_breakdown = _quantify_waste(analyzed, total_wait, total_lead_time)

    return {
        "processes": analyzed,
        "summary": {
            "total_lead_time": round(total_lead_time, 1),
            "total_va_time": round(total_va_time, 1),
            "total_nva_time": round(total_nva_time, 1),
            "total_wait_time": round(total_wait, 1),
            "process_efficiency": round(process_efficiency, 1),
            "takt_time": takt_time,
            "daily_demand": daily_demand,
            "bottleneck_name": bottleneck["name"],
            "bottleneck_ct": bottleneck["effective_cycle_time"],
            "num_processes": len(analyzed),
        },
        "kaizen_opportunities": kaizen_opportunities,
        "waste_breakdown": waste_breakdown,
    }


def _identify_kaizen_opportunities(analyzed: list, takt_time: float, bottleneck: dict) -> list:
    """
    Applies TPS heuristics to flag improvement opportunities.
    Each opportunity has a type, target process, severity, and description.
    """
    opportunities = []

    for step in analyzed:
        name = step["name"]

        # Bottleneck — highest priority kaizen target
        if step["name"] == bottleneck["name"]:
            gap = step["effective_cycle_time"] - takt_time
            if gap > 0:
                opportunities.append({
                    "type": "Bottleneck",
                    "process": name,
                    "severity": "High",
                    "description": (
                        f"{name} is the bottleneck: cycle time {step['effective_cycle_time']}s "
                        f"exceeds takt time {takt_time}s by {round(gap, 1)}s. "
                        f"This limits throughput for the entire value stream."
                    ),
                })

        # High wait time — indicates inventory buildup (waste: Inventory + Waiting)
        if step["wait_time"] > takt_time * 2:
            opportunities.append({
                "type": "Waiting / Inventory",
                "process": name,
                "severity": "Medium",
                "description": (
                    f"{name} has {step['wait_time']}s of wait time before processing — "
                    f"over 2× takt time. WIP is piling up here. Investigate upstream pacing."
                ),
            })

        # High defect rate — waste: Defects, also inflates effective CT
        if step["defect_rate"] > 0.05:
            opportunities.append({
                "type": "Defects",
                "process": name,
                "severity": "High" if step["defect_rate"] > 0.10 else "Medium",
                "description": (
                    f"{name} has a {round(step['defect_rate'] * 100, 1)}% defect rate. "
                    f"This inflates effective cycle time to {step['effective_cycle_time']}s "
                    f"and drives rework and scrap costs."
                ),
            })

        # Non-value-added step — candidate for elimination
        if not step["value_added"]:
            opportunities.append({
                "type": "Non-Value-Added Step",
                "process": name,
                "severity": "Medium",
                "description": (
                    f"{name} is flagged as non-value-added (customer doesn't pay for it). "
                    f"Evaluate if this step can be eliminated, combined, or automated."
                ),
            })

        # Overloaded but not the primary bottleneck
        if step["overloaded"] and step["name"] != bottleneck["name"]:
            opportunities.append({
                "type": "Overloaded Station",
                "process": name,
                "severity": "Medium",
                "description": (
                    f"{name} cycle time ({step['effective_cycle_time']}s) exceeds takt time "
                    f"({takt_time}s). Consider adding capacity or redistributing work."
                ),
            })

    return opportunities


def _quantify_waste(analyzed: list, total_wait: float, total_lead_time: float) -> dict:
    """Returns a breakdown of waste categories for the dashboard chart."""
    defect_time = sum(
        s["effective_cycle_time"] - s["cycle_time"] for s in analyzed
    )
    nva_process_time = sum(
        s["cycle_time"] for s in analyzed if not s["value_added"]
    )

    return {
        "waiting": round(total_wait, 1),
        "defects": round(defect_time, 1),
        "non_value_added_processing": round(nva_process_time, 1),
    }


def build_ai_prompt(analysis: dict, processes: list[dict]) -> str:
    """
    Constructs the prompt sent to OpenAI. Structured so the model has all
    quantitative context needed to give specific, actionable lean recommendations.
    """
    s = analysis["summary"]
    kaizen = analysis["kaizen_opportunities"]
    waste = analysis["waste_breakdown"]

    process_lines = "\n".join(
        f"  - {p['name']}: CT={p['effective_cycle_time']}s, "
        f"Wait={p['wait_time']}s, Workers={p['workers']}, "
        f"Defect={round(p['defect_rate'] * 100, 1)}%, "
        f"VA={'Yes' if p['value_added'] else 'No'}, "
        f"Utilization={p['utilization']}%"
        for p in analysis["processes"]
    )

    kaizen_lines = "\n".join(
        f"  - [{k['severity']}] {k['type']} at {k['process']}: {k['description']}"
        for k in kaizen
    ) or "  - No critical issues detected."

    prompt = f"""You are a lean manufacturing expert trained in Toyota Production System principles.

Analyze this Value Stream Map and provide specific, actionable improvement recommendations.

=== VALUE STREAM SUMMARY ===
Total Lead Time: {s['total_lead_time']}s
Value-Added Time: {s['total_va_time']}s
Non-Value-Added Time: {s['total_nva_time']}s
Process Efficiency: {s['process_efficiency']}%
Takt Time: {s['takt_time']}s (customer demand rate)
Daily Demand: {s['daily_demand']} units
Bottleneck: {s['bottleneck_name']} ({s['bottleneck_ct']}s)

=== PROCESS STEPS ===
{process_lines}

=== IDENTIFIED WASTE ===
- Waiting/Queue Time: {waste['waiting']}s
- Defect Rework Time: {waste['defects']}s
- Non-Value-Added Processing: {waste['non_value_added_processing']}s

=== KAIZEN OPPORTUNITIES DETECTED ===
{kaizen_lines}

Please provide:
1. Three to five specific improvement recommendations, each referencing actual numbers from the data above
2. Which Toyota Production System tool applies (e.g., SMED, Poka-Yoke, Kanban, Heijunka, Andon)
3. Estimated impact on process efficiency if implemented
4. Priority order for implementation

Be direct and practical. Use plain English a plant manager can act on immediately."""

    return prompt
