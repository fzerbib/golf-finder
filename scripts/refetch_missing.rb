#!/usr/bin/env ruby
# Re-fetch just the regions that failed with HTTP 504 in the first pass, and
# append their results into the existing data/osm_golfs.json.
require "net/http"
require "uri"
require "json"

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

MISSING = {
  "FR-BFC" => ["France", "Bourgogne-Franche-Comté"],
  "FR-COR" => ["France", "Corse"],
  "FR-HDF" => ["France", "Hauts-de-France"],
  "FR-PAC" => ["France", "Provence-Alpes-Côte d'Azur"],
  "ES-AS" => ["Espagne", "Asturies"],
  "ES-CB" => ["Espagne", "Cantabrie"],
  "ES-CT" => ["Espagne", "Catalogne"],
  "ES-RI" => ["Espagne", "La Rioja"],
  "ES-PV" => ["Espagne", "Pays basque"]
}.freeze

def fetch_region(iso_code, attempt = 1)
  query = <<~QL
    [out:json][timeout:90];
    area["ISO3166-2"="#{iso_code}"]["admin_level"="4"]->.a;
    (
      node["leisure"="golf_course"](area.a);
      way["leisure"="golf_course"](area.a);
      relation["leisure"="golf_course"](area.a);
    );
    out center tags;
  QL

  uri = URI(OVERPASS_URL)
  http = Net::HTTP.new(uri.host, uri.port)
  http.use_ssl = true
  http.open_timeout = 20
  http.read_timeout = 110
  request = Net::HTTP::Post.new(uri.request_uri)
  request["User-Agent"] = "golf-finder-research/1.0 (contact: local test script)"
  request["Accept"] = "*/*"
  request.set_form_data("data" => query)
  res = http.request(request)

  if ["429", "504", "502", "503"].include?(res.code) && attempt <= 5
    wait = 25 * attempt
    warn "  ! HTTP #{res.code} for #{iso_code}, retrying in #{wait}s (attempt #{attempt})"
    sleep wait
    return fetch_region(iso_code, attempt + 1)
  end

  unless res.is_a?(Net::HTTPSuccess)
    warn "  ! HTTP #{res.code} for #{iso_code}, giving up"
    return []
  end

  body = JSON.parse(res.body)
  elements = body["elements"] || []
  elements.select { |e| e.dig("tags", "name") }
rescue => e
  if attempt <= 4
    warn "  ! Error for #{iso_code}: #{e.message}, retrying in 20s (attempt #{attempt})"
    sleep 20
    return fetch_region(iso_code, attempt + 1)
  end
  warn "  ! Error for #{iso_code}: #{e.message}, giving up"
  []
end

def to_record(el, country, region)
  tags = el["tags"] || {}
  {
    "osmType" => el["type"],
    "osmId" => el["id"],
    "name" => tags["name"],
    "country" => country,
    "region" => region,
    "city" => tags["addr:city"],
    "lat" => el["lat"] || el.dig("center", "lat"),
    "lon" => el["lon"] || el.dig("center", "lon"),
    "website" => tags["website"] || tags["contact:website"],
    "phone" => tags["phone"] || tags["contact:phone"],
    "operator" => tags["operator"],
    "holesTag" => tags["golf"]
  }
end

existing = JSON.parse(File.read("data/osm_golfs.json"))
new_records = []

MISSING.each do |iso, (country, label)|
  print "Re-fetching #{country} / #{label} (#{iso})... "
  $stdout.flush
  els = fetch_region(iso)
  els.each { |el| new_records << to_record(el, country, label) }
  puts "#{els.length} golf(s)"
  sleep 3
end

combined = existing + new_records
seen = {}
deduped = []
combined.each do |rec|
  key = [rec["name"].to_s.strip.downcase, rec["lat"]&.round(3), rec["lon"]&.round(3)]
  next if seen[key]
  seen[key] = true
  deduped << rec
end

File.write("data/osm_golfs.json", JSON.pretty_generate(deduped))
puts "\nAdded #{new_records.length}, total after merge+dedupe: #{deduped.length}"
