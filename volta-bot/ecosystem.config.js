// ecosystem.config.js
// PM2 process definitions so the VOLTA bot AND its web manager auto-start and
// auto-restart together. After `pm2 start ecosystem.config.js` run `pm2 save`
// (and `pm2 startup` / pm2-windows-startup) so they revive after a reboot.
module.exports = {
  apps: [
    {
      name: 'volta-bot',
      script: 'index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'volta-web',
      script: 'web/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
