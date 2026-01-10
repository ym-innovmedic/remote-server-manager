import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

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
      const content = 'host1 ansible_host=10.0.0.1 comment="OVM Manager"';
      const result = parser.parse(content);

      const host = result.ungroupedHosts[0];
      expect(host.comment).to.equal('OVM Manager');
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
      const content = `host1 util_list="['tms-nginx','tms-archiving','tms-purging']"`;
      const result = parser.parse(content);

      const host = result.ungroupedHosts[0];
      expect(host.rawVariables['util_list']).to.equal(`"['tms-nginx','tms-archiving','tms-purging']"`);
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

  describe('Real Inventory File - tms', () => {
    let tmsContent: string;

    before(() => {
      const fixturePath = path.join(__dirname, '../fixtures/tms');
      tmsContent = fs.readFileSync(fixturePath, 'utf-8');
    });

    it('should parse tms file without errors', () => {
      expect(() => parser.parse(tmsContent)).to.not.throw();
    });

    it('should identify all hosts', () => {
      const result = parser.parse(tmsContent);

      // Count all hosts across groups and ungrouped
      let hostCount = result.ungroupedHosts.length;
      for (const group of result.groups) {
        hostCount += group.hosts.length;
      }

      // The tms file has 30+ hosts
      expect(hostCount).to.be.greaterThan(25);
    });

    it('should identify WinRM hosts correctly', () => {
      const result = parser.parse(tmsContent);

      // Find a known WinRM host
      let inobizHost = null;
      for (const group of result.groups) {
        const found = group.hosts.find(h => h.name.includes('inobiz1.prod.thn'));
        if (found) {
          inobizHost = found;
          break;
        }
      }

      expect(inobizHost).to.exist;
      expect(inobizHost!.ansible_connection).to.equal('winrm');
      expect(inobizHost!.ansible_port).to.equal(5985);
    });

    it('should parse hosts with comment variable', () => {
      const result = parser.parse(tmsContent);

      // Find host with comment="OVM Manager"
      let ovmHost = null;
      for (const group of result.groups) {
        const found = group.hosts.find(h => h.name === 'sethnpl008');
        if (found) {
          ovmHost = found;
          break;
        }
      }

      expect(ovmHost).to.exist;
      expect(ovmHost!.comment).to.equal('OVM Manager');
    });

    it('should parse hosts without ansible_host', () => {
      const result = parser.parse(tmsContent);

      // service1.prod.thn.tms.int.pagero.com has no ansible_host
      let serviceHost = null;
      for (const group of result.groups) {
        const found = group.hosts.find(h => h.name === 'service1.prod.thn.tms.int.pagero.com');
        if (found) {
          serviceHost = found;
          break;
        }
      }

      expect(serviceHost).to.exist;
      expect(serviceHost!.ansible_host).to.be.undefined;
    });

    it('should preserve complex variables with arrays', () => {
      const result = parser.parse(tmsContent);

      // Find a host with util_list
      let hostWithUtilList = null;
      for (const group of result.groups) {
        const found = group.hosts.find(h => h.rawVariables['util_list']);
        if (found) {
          hostWithUtilList = found;
          break;
        }
      }

      expect(hostWithUtilList).to.exist;
      expect(hostWithUtilList!.rawVariables['util_list']).to.include('tms-');
    });

    it('should identify group hierarchies (children)', () => {
      const result = parser.parse(tmsContent);

      // Find weblogic:children group
      const weblogicGroup = result.groups.find(g => g.name === 'weblogic');
      expect(weblogicGroup).to.exist;
      expect(weblogicGroup!.children.length).to.be.greaterThan(0);
      expect(weblogicGroup!.children).to.include('weblogic_prod_thn');
    });

    it('should parse group vars sections', () => {
      const result = parser.parse(tmsContent);

      // Find prod_thn:vars
      const prodThnGroup = result.groups.find(g => g.name === 'prod_thn');
      expect(prodThnGroup).to.exist;
      expect(prodThnGroup!.vars['site_env']).to.equal('thn/prod');
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

    it('should preserve tms file data through round-trip', () => {
      const fixturePath = path.join(__dirname, '../fixtures/tms');
      const originalContent = fs.readFileSync(fixturePath, 'utf-8');

      const firstParse = parser.parse(originalContent);
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
      const weblogicProdThn1 = firstParse.groups.find(g => g.name === 'weblogic_prod_thn');
      const weblogicProdThn2 = secondParse.groups.find(g => g.name === 'weblogic_prod_thn');

      expect(weblogicProdThn2!.hosts.length).to.equal(weblogicProdThn1!.hosts.length);

      // Check a specific host's variables are preserved
      const host1 = weblogicProdThn1!.hosts.find(h => h.name.includes('weblogic1'));
      const host2 = weblogicProdThn2!.hosts.find(h => h.name.includes('weblogic1'));

      expect(host2!.ansible_host).to.equal(host1!.ansible_host);
    });
  });
});
