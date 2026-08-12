// --- CONFIGURATION PARAMETERS (Matching travel_processor.py) ---
const MAX_CLUSTER_RADIUS_KM = 0.25;      // 250m radius
const MAX_STATIONARY_GAP_MINS = 45;       // 45 min idle threshold
const OVERNIGHT_HOTEL_RADIUS_KM = 1.5;    // 1.5 km tolerance for hotel drift

/**
 * Calculates distance in kilometers between two GPS coordinates using the Haversine formula.
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v === null || v === undefined)) {
    return null;
  }

  const R = 6371.0;
  const dLat = (lat2 - lat1) * (Math.PI / 180.0);
  const dLon = (lon2 - lon1) * (Math.PI / 180.0);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180.0)) *
      Math.cos(lat2 * (Math.PI / 180.0)) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Spatio-temporal clustering algorithm with overnight hotel drift tolerance.
 * Expects an array of photo objects: [{ filename, timestamp, latitude, longitude, altitude }]
 */
export function clusterPhotosSpatially(photos) {
  if (!photos || photos.length === 0) return [];

  // Sort chronologically by timestamp
  const sortedPhotos = [...photos].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );

  const rawClusters = [];
  let currentCluster = [sortedPhotos[0]];

  for (let i = 1; i < sortedPhotos.length; i++) {
    const photo = sortedPhotos[i];
    const prevPhoto = currentCluster[currentCluster.length - 1];

    const lats = currentCluster.map((p) => p.latitude).filter((v) => v !== null);
    const lons = currentCluster.map((p) => p.longitude).filter((v) => v !== null);

    let distToCenter = null;
    if (lats.length > 0 && lons.length > 0 && photo.latitude !== null && photo.longitude !== null) {
      const centerLat = lats.reduce((a, b) => a + b, 0) / lats.length;
      const centerLon = lons.reduce((a, b) => a + b, 0) / lons.length;
      distToCenter = haversineDistance(centerLat, centerLon, photo.latitude, photo.longitude);
    }

    let timeGapMins = 0;
    if (photo.timestamp && prevPhoto.timestamp) {
      timeGapMins = (new Date(photo.timestamp) - new Date(prevPhoto.timestamp)) / (1000 * 60);
    }

    const isOvernight = timeGapMins > 6 * 60;
    const exceedsRadius = distToCenter !== null && distToCenter > MAX_CLUSTER_RADIUS_KM;
    const exceedsTime = timeGapMins > MAX_STATIONARY_GAP_MINS;

    if (!exceedsRadius && !exceedsTime && !isOvernight) {
      currentCluster.push(photo);
    } else {
      rawClusters.push(currentCluster);
      currentCluster = [photo];
    }
  }

  if (currentCluster.length > 0) {
    rawClusters.push(currentCluster);
  }

  // --- OVERNIGHT HOTEL MERGING PHASE ---
  const finalClusters = [];

  for (const cluster of rawClusters) {
    if (finalClusters.length === 0) {
      finalClusters.push(cluster);
      continue;
    }

    const prevCluster = finalClusters[finalClusters.length - 1];
    const lastPhotoPrev = prevCluster[prevCluster.length - 1];
    const firstPhotoCurr = cluster[0];

    if (lastPhotoPrev.timestamp && firstPhotoCurr.timestamp) {
      const hoursBetween =
        (new Date(firstPhotoCurr.timestamp) - new Date(lastPhotoPrev.timestamp)) / (1000 * 3600);

      const prevLats = prevCluster.map((p) => p.latitude).filter((v) => v !== null);
      const prevLons = prevCluster.map((p) => p.longitude).filter((v) => v !== null);
      const currLats = cluster.map((p) => p.latitude).filter((v) => v !== null);
      const currLons = cluster.map((p) => p.longitude).filter((v) => v !== null);

      if (prevLats.length && prevLons.length && currLats.length && currLons.length) {
        const prevLat = prevLats.reduce((a, b) => a + b, 0) / prevLats.length;
        const prevLon = prevLons.reduce((a, b) => a + b, 0) / prevLons.length;
        const currLat = currLats.reduce((a, b) => a + b, 0) / currLats.length;
        const currLon = currLons.reduce((a, b) => a + b, 0) / currLons.length;

        const driftDist = haversineDistance(prevLat, prevLon, currLat, currLon);

        const isOvernightGap = hoursBetween >= 5.0 && hoursBetween <= 18.0;
        const isWithinHotelArea = driftDist !== null && driftDist <= OVERNIGHT_HOTEL_RADIUS_KM;
        const isMinorDriftCluster = cluster.length <= 3;

        if (isOvernightGap && isWithinHotelArea && isMinorDriftCluster) {
          finalClusters[finalClusters.length - 1].push(...cluster);
          continue;
        }
      }
    }

    finalClusters.push(cluster);
  }

  return finalClusters;
}