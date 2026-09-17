#!/usr/bin/env ruby
# Builds a simplified inline-SVG outline of Andalucía (from OSM/Nominatim boundary
# data) plus the projection constants needed to place golf course dots on it.
# Output: data/andalucia_map.js (SVG path string + project() constants as JS).
require "json"

RAW = JSON.parse(File.read("/tmp/andalucia.json")).first
COORDS = RAW["geojson"]["coordinates"] # MultiPolygon: [ [ [ [lon,lat], ... ] ], ... ]

# Flatten to a list of outer rings (first ring of each polygon), keep only
# rings with enough points to matter (drops tiny offshore islets).
rings = COORDS.map { |poly| poly[0] }.select { |ring| ring.length > 30 }

# Douglas-Peucker simplification.
def perp_dist(pt, a, b)
  ax, ay = a
  bx, by = b
  px, py = pt
  dx = bx - ax
  dy = by - ay
  return Math.hypot(px - ax, py - ay) if dx == 0 && dy == 0
  t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
  cx = ax + t * dx
  cy = ay + t * dy
  Math.hypot(px - cx, py - cy)
end

def rdp(points, epsilon)
  return points if points.length < 3
  dmax = 0.0
  index = 0
  (1...points.length - 1).each do |i|
    d = perp_dist(points[i], points[0], points[-1])
    if d > dmax
      index = i
      dmax = d
    end
  end
  if dmax > epsilon
    left = rdp(points[0..index], epsilon)
    right = rdp(points[index..-1], epsilon)
    left[0..-2] + right
  else
    [points[0], points[-1]]
  end
end

simplified = rings.map { |ring| rdp(ring, 0.018) }.select { |ring| ring.length >= 6 }
puts "Rings kept: #{simplified.length}, points: #{simplified.map(&:length).inspect} (raw: #{rings.map(&:length).inspect})"

all_pts = simplified.flatten(1)
lons = all_pts.map { |p| p[0] }
lats = all_pts.map { |p| p[1] }
lon_min, lon_max = lons.min, lons.max
lat_min, lat_max = lats.min, lats.max
lat_mean_rad = ((lat_min + lat_max) / 2) * Math::PI / 180
cos_lat = Math.cos(lat_mean_rad)

pad = 24
width = 840.0
usable_w = width - 2 * pad
lon_span = (lon_max - lon_min) * cos_lat
scale = usable_w / lon_span
lat_span = (lat_max - lat_min)
height = lat_span * scale + 2 * pad

def project(lon, lat, lon_min, lat_max, cos_lat, scale, pad)
  x = (lon - lon_min) * cos_lat * scale + pad
  y = (lat_max - lat) * scale + pad
  [x.round(1), y.round(1)]
end

paths = simplified.map do |ring|
  pts = ring.map { |lon, lat| project(lon, lat, lon_min, lat_max, cos_lat, scale, pad) }
  "M" + pts.map { |x, y| "#{x} #{y}" }.join(" L") + " Z"
end

js = <<~JS
  // Simplified outline of Andalucía for the map view (from OpenStreetMap boundary
  // data via Nominatim, Douglas-Peucker simplified). © OpenStreetMap contributors, ODbL.
  const ANDALUCIA_MAP = {
    viewBoxWidth: #{width.round(1)},
    viewBoxHeight: #{height.round(1)},
    coastlinePath: #{paths.join(" ").to_json},
    project: function (lon, lat) {
      const lonMin = #{lon_min};
      const latMax = #{lat_max};
      const cosLat = #{cos_lat};
      const scale = #{scale};
      const pad = #{pad};
      return [ (lon - lonMin) * cosLat * scale + pad, (latMax - lat) * scale + pad ];
    }
  };
JS

File.write("data/andalucia_map.js", js)
puts "viewBox: 0 0 #{width.round(1)} #{height.round(1)}"
puts "Written to data/andalucia_map.js"
