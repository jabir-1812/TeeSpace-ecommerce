import { createLogger, format, transports } from 'winston';
const { combine, timestamp, printf, colorize, uncolorize } = format;

// custom log format
const logFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level}]: ${message}`;
});

const logger = createLogger({
  level: 'info',
  format: combine(
    colorize({ all: true }), // color for console
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    new transports.File({
      filename: 'logs/combined.log',
      format: uncolorize(), // remove colors from file
    }),
    new transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: uncolorize(),
    })
  ]
});

export default  logger ;

