import { expect } from 'chai';

// We need to import the parser and models without vscode dependency
// Create a mock for vscode
const mockVscode = {};
(global as unknown as { vscode: unknown }).vscode = mockVscode;

// Import the parser
import { AnsibleParser } from '../../src/parsers/AnsibleParser';

describe('AnsibleParser', () => {
  let parser: AnsibleParser;

  beforeEach(() => {
    parser = new AnsibleParser();
  });

  describe('Basic Parsing', () => {
    it('should parse empty content', () => {
      const result = parser.parse('');
      expect(result.groups).to.deep.equal([]);
      expect(result.ungroupedHosts).to.deep.equal([]);
      expect(result.headerComments).to.deep.equal([]);
    });

    it('should parse simple host entry', () => {
      const content = 'server1.example.com ansible_host=10.0.0.1';
      const result = parser.parse(content);

      expect(result.ungroupedHosts).to.have.length(1);
      expect(result.ungroupedHosts[0].name).to.equal('server1.example.com');
      expect(result.ungroupedHosts[0].ansible_host).to.equal('10.0.0.1');
    });

    it('should parse host without ansible_host', () => {
      const content = 'server1.example.com';
      const result = parser.parse(content);

      expect(result.ungroupedHosts).to.have.length(1);
      expect(result.ungroupedHosts[0].name).to.equal('server1.example.com');
      expect(result.ungroupedHosts[0].ansible_host).to.be.undefined;
    });

    it('should parse header comments', () => {
      const content = `# Header comment 1
# Header comment 2

[group1]
host1`;
      const result = parser.parse(content);

      expect(result.headerComments).to.have.length(2);
      expect(result.headerComments[0]).to.equal('# Header comment 1');
      expect(result.headerComments[1]).to.equal('# Header comment 2');
    });
  });

  describe('Group Parsing', () => {
    it('should parse simple group', () => {
      const content = `[webservers]
web1.example.com ansible_host=10.0.0.1
web2.example.com ansible_host=10.0.0.2`;
      const result = parser.parse(content);

      expect(result.groups).to.have.length(1);
      expect(result.groups[0].name).to.equal('webservers');
      expect(result.groups[0].hosts).to.have.length(2);
    });

    it('should parse group with children', () => {
      const content = `[webservers]
web1.example.com

[dbservers]
db1.example.com

[all_servers:children]
webservers
dbservers`;
      const result = parser.parse(content);

      const allServersGroup = result.groups.find(g => g.name === 'all_servers');
      expect(allServersGroup).to.exist;
      expect(allServersGroup!.children).to.include('webservers');
      expect(allServersGroup!.children).to.include('dbservers');
    });

    it('should parse group vars', () => {
      const content = `[webservers]
web1.example.com

[webservers:vars]
http_port=80
https_port=443`;
      const result = parser.parse(content);

      const webservers = result.groups.find(g => g.name === 'webservers');
      expect(webservers).to.exist;
      expect(webservers!.vars['http_port']).to.equal('80');
      expect(webservers!.vars['https_port']).to.equal('443');
    });
  });

  describe('Variable Parsing', () => {
    it('should parse standard ansible variables', () => {
      const content = 'host1 ansible_host=10.0.0.1 ansible_port=22 ansible_user=admin ansible_connection=ssh';
      const result = parser.parse(content);

      const host = result.ungroupedHosts[0];
      expect(host.ansible_host).to.equal('10.0.0.1');
      expect(host.ansible_port).to.equal(22);
      expect(host.ansible_user).to.equal('admin');
      expect(host.ansible_connection).to.equal('ssh');
    });

    it('should parse WinRM variables', () => {
      const content = 'winhost ansible_host=10.0.0.1 ansible_port=5985 ansible_connection=winrm ansible_winrm_transport=ntlm ansible_winrm_server_cert_validation=ignore';
      const result = parser.parse(content);

      const host = result.ungroupedHosts[0];
      expect(host.ansible_connection).to.equal('winrm');
      expect(host.ansible_winrm_transport).to.equal('ntlm');
      expect(host.ansible_winrm_server_cert_validation).to.equal('ignore');
    });

    it('should parse remote_mgr extension variables', () => {
      const content = 'host1 ansible_host=10.0.0.1 remote_mgr_connection_type=rdp remote_mgr_credential_id=cred1 remote_mgr_domain=DOMAIN';
      const result = parser.parse(content);

      const host = result.ungroupedHosts[0];
      expect(host.remote_mgr_connection_type).to.equal('rdp');
      expect(host.remote_mgr_credential_id).to.equal('cred1');
      expect(host.remote_mgr_domain).to.equal('DOMAIN');
    });

    it('should parse quoted display name', () => {
      const content = 'host1 ansible_host=10.0.0.1 remote_mgr_display_name="Production Server 1"';
      const result = parser.parse(content);

      const host = result.ungroupedHosts[0];
      expect(host.remote_mgr_display_name).to.equal('Production Server 1');
    });

    it('should parse comment variable', () => {
      const content = 'host1 ansible_host=10.0.0.1 comment="Test Server"';
      const result = parser.parse(content);

      const host = result.ungroupedHosts[0];
      expect(host.comment).to.equal('Test Server');
    });

    it('should preserve raw variables', () => {
      const content = 'host1 ansible_host=10.0.0.1 custom_var=custom_value keepalived_state=MASTER';
      const result = parser.parse(content);

      const host = result.ungroupedHosts[0];
      expect(host.rawVariables['custom_var']).to.equal('custom_value');
      expect(host.rawVariables['keepalived_state']).to.equal('MASTER');
    });
  });

  describe('Complex Variable Handling', () => {
    it('should handle quoted array values', () => {
      const content = `host1 util_list="['nginx','archiving','purging']"`;
      const result = parser.parse(content);

      const host = result.ungroupedHosts[0];
      expect(host.rawVariables['util_list']).to.equal(`"['nginx','archiving','purging']"`);
    });

    it('should handle single-quoted values', () => {
      const content = `host1 enabled='true' disabled='false'`;
      const result = parser.parse(content);

      const host = result.ungroupedHosts[0];
      expect(host.rawVariables['enabled']).to.equal(`'true'`);
      expect(host.rawVariables['disabled']).to.equal(`'false'`);
    });

    it('should handle mixed quote styles', () => {
      const content = `host1 var1='value1' var2="value2" var3=value3`;
      const result = parser.parse(content);

      const host = result.ungroupedHosts[0];
      expect(host.rawVariables['var1']).to.equal(`'value1'`);
      expect(host.rawVariables['var2']).to.equal(`"value2"`);
      expect(host.rawVariables['var3']).to.equal('value3');
    });
  });

  describe('Comment Handling', () => {
    it('should parse inline comments', () => {
      const content = `host1 ansible_host=10.0.0.1 # This is a comment`;
      const result = parser.parse(content);

      const host = result.ungroupedHosts[0];
      expect(host.inlineComment).to.equal('# This is a comment');
    });

    it('should not parse # inside quotes as comment', () => {
      const content = `host1 comment="Test #1 Server"`;
      const result = parser.parse(content);

      const host = result.ungroupedHosts[0];
      expect(host.comment).to.equal('Test #1 Server');
    });

    it('should preserve section comments', () => {
      const content = `[webservers]
# This is a comment about web1
web1.example.com`;
      const result = parser.parse(content);

      const group = result.groups.find(g => g.name === 'webservers');
      expect(group).to.exist;
      expect(group!.comments).to.include('# This is a comment about web1');
    });
  });

  describe('Serialization', () => {
    it('should serialize simple host', () => {
      const content = 'host1 ansible_host=10.0.0.1';
      const result = parser.parse(content);
      const serialized = parser.serialize(result);

      expect(serialized).to.include('host1');
      expect(serialized).to.include('ansible_host=10.0.0.1');
    });

    it('should serialize groups', () => {
      const content = `[webservers]
web1.example.com ansible_host=10.0.0.1`;
      const result = parser.parse(content);
      const serialized = parser.serialize(result);

      expect(serialized).to.include('[webservers]');
      expect(serialized).to.include('web1.example.com');
    });

    it('should serialize group children', () => {
      const content = `[webservers]
web1.example.com

[all:children]
webservers`;
      const result = parser.parse(content);
      const serialized = parser.serialize(result);

      expect(serialized).to.include('[all:children]');
      expect(serialized).to.include('webservers');
    });

    it('should serialize group vars', () => {
      const content = `[webservers]
web1.example.com

[webservers:vars]
http_port=80`;
      const result = parser.parse(content);
      const serialized = parser.serialize(result);

      expect(serialized).to.include('[webservers:vars]');
      expect(serialized).to.include('http_port=80');
    });
  });

  describe('Round-Trip Integrity', () => {
    it('should preserve data through parse-serialize-parse cycle', () => {
      const content = `# Header comment
[webservers]
web1.example.com ansible_host=10.0.0.1 ansible_port=22
web2.example.com ansible_host=10.0.0.2

[webservers:vars]
http_port=80

[all:children]
webservers`;

      const firstParse = parser.parse(content);
      const serialized = parser.serialize(firstParse);
      const secondParse = parser.parse(serialized);

      // Compare structure
      expect(secondParse.groups.length).to.equal(firstParse.groups.length);

      const webservers1 = firstParse.groups.find(g => g.name === 'webservers');
      const webservers2 = secondParse.groups.find(g => g.name === 'webservers');

      expect(webservers2!.hosts.length).to.equal(webservers1!.hosts.length);
      expect(webservers2!.vars['http_port']).to.equal(webservers1!.vars['http_port']);
    });

    it('should preserve complex inventory through round-trip', () => {
      const content = `# Production Inventory
[webservers]
web1.example.com ansible_host=10.0.0.1 ansible_port=22
web2.example.com ansible_host=10.0.0.2 ansible_port=22

[databases]
db1.example.com ansible_host=10.0.0.10
db2.example.com ansible_host=10.0.0.11

[prod:children]
webservers
databases

[prod:vars]
env=production
region=us-east`;

      const firstParse = parser.parse(content);
      const serialized = parser.serialize(firstParse);
      const secondParse = parser.parse(serialized);

      // Count hosts in both parses
      const countHosts = (result: ReturnType<typeof parser.parse>) => {
        let count = result.ungroupedHosts.length;
        for (const group of result.groups) {
          count += group.hosts.length;
        }
        return count;
      };

      expect(countHosts(secondParse)).to.equal(countHosts(firstParse));

      // Compare group counts
      expect(secondParse.groups.length).to.equal(firstParse.groups.length);

      // Verify specific data is preserved
      const webservers1 = firstParse.groups.find(g => g.name === 'webservers');
      const webservers2 = secondParse.groups.find(g => g.name === 'webservers');

      expect(webservers2!.hosts.length).to.equal(webservers1!.hosts.length);

      // Check host variables are preserved
      const host1 = webservers1!.hosts.find(h => h.name === 'web1.example.com');
      const host2 = webservers2!.hosts.find(h => h.name === 'web1.example.com');

      expect(host2!.ansible_host).to.equal(host1!.ansible_host);
    });
  });
});
