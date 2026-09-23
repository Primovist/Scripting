type VehicleCoordinate = { latitude: number; longitude: number }

type MapSnapshot = {
  image: any
  size: { width: number; height: number }
  point: (coordinate: VehicleCoordinate) => { x: number; y: number }
}

function validCoordinate(coordinate: VehicleCoordinate | null | undefined): coordinate is VehicleCoordinate {
  if (!coordinate) return false
  const { latitude, longitude } = coordinate
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false
  if (latitude === 0 && longitude === 0) return false
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return false
  return true
}

export async function takeVehicleMapSnapshot(options: {
  coordinate: VehicleCoordinate
  width: number
  height: number
  appearance?: "light" | "dark"
  vehicleName?: string
}): Promise<MapSnapshot | null> {
  if (!validCoordinate(options.coordinate)) return null

  const width = Math.max(64, Math.round(options.width))
  const height = Math.max(48, Math.round(options.height))
  const common = {
    region: {
      center: options.coordinate,
      span: { latitudeDelta: 0.01, longitudeDelta: 0.01 },
    },
    size: { width, height },
    appearance: options.appearance,
    annotations: [{
      coordinate: options.coordinate,
      tintColor: "#2F80ED" as any,
      glyph: "car.fill",
    }],
  }

  try {
    const snapshot = await MapSnapshotter.take({
      ...common,
      mapStyle: {
        style: "standard",
        elevation: "flat",
        showsTraffic: false,
        pointsOfInterest: "excludingAll",
      },
    })
    return snapshot?.image ? snapshot : null
  } catch (error) {
    console.warn("车辆地图快照生成失败：", error instanceof Error ? error.message : String(error))
    return null
  }
}
