/** Side-effect-only module: sets DB_APPLICATION_NAME before any other import reads it. */
process.env.DB_APPLICATION_NAME = 'flashseat-sweeper';
