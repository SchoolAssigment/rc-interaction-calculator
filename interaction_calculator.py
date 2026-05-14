from __future__ import annotations

from dataclasses import dataclass
from math import pi
from typing import Dict, List, Optional


@dataclass(frozen=True)
class Material:
    fck_mpa: float = 35.0
    fyk_mpa: float = 400.0
    gamma_c: float = 1.5
    gamma_s: float = 1.15
    eta_cc: float = 1.0
    k_tc: float = 1.0
    es_mpa: float = 200_000.0
    eps_cu_per_mille: float = 3.5
    lambda_block: float = 0.8

    @property
    def fcd_mpa(self) -> float:
        return self.eta_cc * self.k_tc * self.fck_mpa / self.gamma_c

    @property
    def fyd_mpa(self) -> float:
        return self.fyk_mpa / self.gamma_s

    @property
    def eps_y_per_mille(self) -> float:
        return self.fyd_mpa / self.es_mpa * 1000.0


@dataclass(frozen=True)
class RebarLayer:
    z_mm: float
    bars: int


@dataclass(frozen=True)
class Section:
    width_mm: float = 300.0
    height_mm: float = 500.0
    bar_diameter_mm: float = 20.0
    rebar_layers: tuple[RebarLayer, ...] = (
        RebarLayer(50.0, 2),
        RebarLayer(250.0, 2),
        RebarLayer(450.0, 2),
    )

    @property
    def bar_area_mm2(self) -> float:
        return pi * self.bar_diameter_mm**2 / 4.0

    @property
    def sorted_rebar_layers(self) -> List[RebarLayer]:
        return sorted(self.rebar_layers, key=lambda layer: layer.z_mm)

    @property
    def layer_positions_mm(self) -> List[float]:
        return [layer.z_mm for layer in self.sorted_rebar_layers]

    @property
    def total_steel_area_mm2(self) -> float:
        return sum(layer.bars * self.bar_area_mm2 for layer in self.sorted_rebar_layers)


def steel_stress_mpa(strain_per_mille: float, material: Material) -> float:
    """Positive strain/stress is compression; negative is tension."""
    elastic = material.es_mpa * strain_per_mille / 1000.0
    return max(-material.fyd_mpa, min(material.fyd_mpa, elastic))


def calculate_point(
    section: Section,
    material: Material,
    neutral_axis_mm: Optional[float] = None,
    bottom_tension_strain_per_mille: Optional[float] = None,
    pure_compression: bool = False,
    pure_tension: bool = False,
) -> Dict[str, object]:
    if pure_compression and pure_tension:
        raise ValueError("Choose pure compression or pure tension, not both.")

    layers = section.sorted_rebar_layers
    positions = [layer.z_mm for layer in layers]
    if not layers:
        raise ValueError("At least one reinforcement layer is required.")

    bottom_depth = positions[-1]
    eps_cu = material.eps_cu_per_mille

    if pure_compression:
        steel_layers = []
        steel_force_kn_total = 0.0
        steel_moment_knm_total = 0.0
        for index, layer in enumerate(layers, start=1):
            z_mm = layer.z_mm
            stress = material.fyd_mpa
            layer_area = layer.bars * section.bar_area_mm2
            force_kn = layer_area * stress / 1000.0
            lever_m = (section.height_mm / 2.0 - z_mm) / 1000.0
            steel_force_kn_total += force_kn
            steel_moment_knm_total += force_kn * lever_m
            steel_layers.append(_layer_result(index, z_mm, layer.bars, layer_area, eps_cu, stress, force_kn, lever_m))

        concrete_force_kn = material.fcd_mpa * section.width_mm * section.height_mm / 1000.0
        concrete_lever_m = 0.0
        return _result(
            "pure compression",
            None,
            section.height_mm,
            concrete_force_kn,
            concrete_lever_m,
            steel_layers,
            concrete_force_kn + steel_force_kn_total,
            steel_moment_knm_total,
            material,
            section,
        )

    if pure_tension:
        steel_layers = []
        steel_force_kn_total = 0.0
        steel_moment_knm_total = 0.0
        for index, layer in enumerate(layers, start=1):
            z_mm = layer.z_mm
            stress = -material.fyd_mpa
            layer_area = layer.bars * section.bar_area_mm2
            force_kn = layer_area * stress / 1000.0
            lever_m = (section.height_mm / 2.0 - z_mm) / 1000.0
            steel_force_kn_total += force_kn
            steel_moment_knm_total += force_kn * lever_m
            steel_layers.append(_layer_result(index, z_mm, layer.bars, layer_area, -material.eps_y_per_mille, stress, force_kn, lever_m))

        return _result(
            "pure tension",
            None,
            0.0,
            0.0,
            0.0,
            steel_layers,
            steel_force_kn_total,
            steel_moment_knm_total,
            material,
            section,
        )

    if bottom_tension_strain_per_mille is not None:
        if bottom_tension_strain_per_mille < 0:
            raise ValueError("Bottom tension strain should be entered as a positive per-mille value.")
        neutral_axis_mm = bottom_depth * eps_cu / (eps_cu + bottom_tension_strain_per_mille)

    if neutral_axis_mm is None or neutral_axis_mm <= 0:
        raise ValueError("Neutral axis depth must be greater than zero.")

    a_mm = min(material.lambda_block * neutral_axis_mm, section.height_mm)
    concrete_force_kn = material.fcd_mpa * section.width_mm * a_mm / 1000.0
    concrete_lever_m = (section.height_mm / 2.0 - a_mm / 2.0) / 1000.0
    concrete_moment_knm = concrete_force_kn * concrete_lever_m

    steel_layers = []
    steel_force_kn_total = 0.0
    steel_moment_knm_total = 0.0
    for index, layer in enumerate(layers, start=1):
        z_mm = layer.z_mm
        strain = eps_cu * (neutral_axis_mm - z_mm) / neutral_axis_mm
        stress = steel_stress_mpa(strain, material)
        layer_area = layer.bars * section.bar_area_mm2
        force_kn = layer_area * stress / 1000.0
        lever_m = (section.height_mm / 2.0 - z_mm) / 1000.0
        steel_force_kn_total += force_kn
        steel_moment_knm_total += force_kn * lever_m
        steel_layers.append(_layer_result(index, z_mm, layer.bars, layer_area, strain, stress, force_kn, lever_m))

    return _result(
        "neutral axis",
        neutral_axis_mm,
        a_mm,
        concrete_force_kn,
        concrete_lever_m,
        steel_layers,
        concrete_force_kn + steel_force_kn_total,
        concrete_moment_knm + steel_moment_knm_total,
        material,
        section,
    )


def generate_curve(section: Section, material: Material, samples: int = 80) -> List[Dict[str, object]]:
    bottom_depth = section.layer_positions_mm[-1]
    x_min = max(1.0, 0.05 * bottom_depth)
    x_max = 2.5 * section.height_mm
    curve = [calculate_point(section, material, pure_tension=True)]
    for i in range(samples):
        ratio = i / max(1, samples - 1)
        x = x_min * (x_max / x_min) ** ratio
        curve.append(calculate_point(section, material, neutral_axis_mm=x))
    curve.append(calculate_point(section, material, pure_compression=True))
    return curve


def _layer_result(index: int, z_mm: float, bars: int, area: float, strain: float, stress: float, force: float, lever: float) -> Dict[str, float]:
    return {
        "layer": index,
        "z_mm": z_mm,
        "bars": bars,
        "area_mm2": area,
        "strain_per_mille": strain,
        "stress_mpa": stress,
        "force_kn": force,
        "lever_m": lever,
        "moment_knm": force * lever,
    }


def _result(
    mode: str,
    x_mm: Optional[float],
    a_mm: float,
    concrete_force_kn: float,
    concrete_lever_m: float,
    steel_layers: List[Dict[str, float]],
    n_rd_kn: float,
    m_rd_knm: float,
    material: Material,
    section: Section,
) -> Dict[str, object]:
    return {
        "mode": mode,
        "x_mm": x_mm,
        "a_mm": a_mm,
        "concrete_force_kn": concrete_force_kn,
        "concrete_lever_m": concrete_lever_m,
        "concrete_moment_knm": concrete_force_kn * concrete_lever_m,
        "steel_layers": steel_layers,
        "n_rd_kn": n_rd_kn,
        "m_rd_knm": m_rd_knm,
        "fcd_mpa": material.fcd_mpa,
        "fyd_mpa": material.fyd_mpa,
        "eps_y_per_mille": material.eps_y_per_mille,
        "total_steel_area_mm2": section.total_steel_area_mm2,
        "layer_positions_mm": section.layer_positions_mm,
        "rebar_layers": [
            {"z_mm": layer.z_mm, "bars": layer.bars, "area_mm2": layer.bars * section.bar_area_mm2}
            for layer in section.sorted_rebar_layers
        ],
    }


if __name__ == "__main__":
    sec = Section()
    mat = Material()
    for label, kwargs in [
        ("pure compression", {"pure_compression": True}),
        ("eps_s1 = 0", {"bottom_tension_strain_per_mille": 0.0}),
        ("eps_s1 = 0.5 eps_y", {"bottom_tension_strain_per_mille": 0.5 * mat.eps_y_per_mille}),
        ("eps_s1 = eps_y", {"bottom_tension_strain_per_mille": mat.eps_y_per_mille}),
        ("x = 150 mm", {"neutral_axis_mm": 150.0}),
        ("pure tension", {"pure_tension": True}),
    ]:
        point = calculate_point(sec, mat, **kwargs)
        print(f"{label:20s} N = {point['n_rd_kn']:8.1f} kN, M = {point['m_rd_knm']:7.1f} kNm")
