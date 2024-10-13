/**
 * Calculate the time difference between two dates in minutes
 *
 * @param {number} start The start timestamp
 * @param {number} end The end timestamp
 * @returns {number} The time difference in minutes
 */
export const timeDiffInMinutes = (start: number, end: number): number => {
  return Math.floor((end - start) / 1000 / 60);
};

/**
 * Convert a time in minutes to a human readable format
 *
 * @param {number} minute The time in minutes
 * @returns {string} The time in a human readable format
 */
export const formatMinuteToBestDisplay = (minute: number): string => {
  if (minute < 60) {
    return `${minute} minute${minute > 1 ? "s" : ""}`;
  }

  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;

  return `${hours} heure${hours > 1 ? "s" : ""} ${minutes} minute${minutes > 1 ? "s" : ""}`;
};
