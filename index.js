const express = require('express')
const https = require('https')
const fs = require('fs')
const { spawn } = require('child_process')
const axios = require('axios')
// Allow self-signed
const httpsAgent = new https.Agent({ rejectUnauthorized: false })

function tmpFile(folder, content, cb) {
    const { join } = require('path')
    const crypto = require('crypto')
    const path = join(folder, crypto.randomBytes(4).toString('hex'))
    fs.writeFile(path, content, (err) =>
        cb(err, path, () => fs.unlink(path, () => { })))
}

const app = express()
app.use(express.json())

app.get('/health', (req, res) => res.send('Alive'))
app.post('/', (req, res) => {
    if (typeof req.body.hash !== 'string') {
        res.status(400).send('Missing hash')
        return
    }
    const args = []
    if ('format' in req.body) {
        if (typeof req.body.format !== 'string' || !/^[a-z0-9-]+$/i.test(req.body.format)) {
            res.status(400).send('Bad format')
            return
        }
        args.push('--format=' + req.body.format)
    }
    const hashes = req.body.hash.split(/\r?\n/)
    tmpFile('/tmp/', hashes.map(h => h + ':' + h).join('\n'), (err, path, done) => {
        if (err) {
            res.status(500).send('Error')
            return
        }
        const returnUrl = `https://${req.socket.remoteAddress.substr(7)}/retour`
        const john = spawn('/opt/john/run/john', [...args, path], { timeout: 1000 * 60* 60 })
        john.on('close', code => {
            if (code) console.error('john exit', code)
            done()
        })
        john.stdout.on('data', data => data.toString().trim().split(/\r?\n/).map(text => {
            const openPos = text.indexOf('(')
            const closePos = text.indexOf(')', openPos)
            if (openPos < 0 || closePos < 0) return
            const hash = text.substr(openPos+1, closePos-openPos-1)
            if (!hashes.includes(hash)) return
            const payload = { [hash]: text.substr(0, text.indexOf(' ')) }
            console.log(payload)
            axios.post(returnUrl, payload, { httpsAgent })
                .catch(console.error)
        }))
        res.send('Working')
    })
})

// FIXME: need a domain for real cert
const server = https.createServer({
    key: fs.readFileSync('server.key'),
    cert: fs.readFileSync('server.cert')
}, app)
server.listen(4443)
